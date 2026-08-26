"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.executeServerCommand = executeServerCommand;
exports.handleAdminCommand = handleAdminCommand;
exports.setupStdinCommandHandler = setupStdinCommandHandler;
exports.getAdminHelpText = getAdminHelpText;
const player_1 = require("../player");
const database_1 = require("../database");
const mobs_1 = require("../mobs");
const constants_1 = require("../constants");
const gameState_1 = require("./gameState");
const petal_actions_1 = require("../petal_actions");
const server_1 = require("../server");
const petals_1 = require("../petals");
const playerManager_1 = require("./playerManager");
const maze_1 = require("../maze");
const botManager_1 = require("./botManager");
const autoUpdate_1 = require("./autoUpdate");
const guildManager_1 = require("./guildManager");
const utils_1 = require("./utils");
const tempAdmin_1 = require("./tempAdmin");
// Coordinate validation for commands that place entities (teleport, spawn).
// Positions past MAX_SANE_WORLD_COORD are always typos — and large enough ones
// push tile/cell indices past 2^53 where the collision scan loops can no longer
// increment their counters, hanging the tick loop at 100% CPU.
const isSaneCoord = (v) => Number.isFinite(v) && Math.abs(v) <= constants_1.MAX_SANE_WORLD_COORD;
// Helper function to send message to admin or console
function sendOutput(message, socketId, io) {
    console.log(message);
    if (socketId && io) {
        io.to(socketId).emit('chatMessage', {
            sender: 'System',
            content: message.replace(/\n/g, '<br/>'),
            timestamp: Date.now()
        });
    }
}
/**
 * Execute a server command (can be called from stdin or chat)
 */
function executeServerCommand(command, executor, deps, socketId) {
    const trimmedCommand = command.trim();
    const { io, savePlayerProgress, spawnMob, spawnSpecialMobs, clearAllMobs, adjustEnemyCount } = deps;
    if (executor) {
        sendOutput(`[ADMIN] ${executor} executed: ${trimmedCommand}`, socketId, io);
    }
    if (trimmedCommand.startsWith('save')) {
        const parts = trimmedCommand.split(' ');
        if (parts.length === 2) {
            const playerId = parts[1];
            const player = constants_1.players[playerId];
            const socket = io.sockets.sockets.get(playerId);
            if (player && socket?.userId) {
                savePlayerProgress(player, socket.userId);
                socket.emit('savePlayerProgress', player);
                sendOutput(`Saved player ${player.name} (${playerId})`, socketId, io);
            }
            else {
                sendOutput(`Player ${playerId} not found`, socketId, io);
            }
        }
        else if (parts.length === 1) {
            // Save all players
            let savedCount = 0;
            Object.entries(constants_1.players).forEach(([socketId, player]) => {
                const socket = io.sockets.sockets.get(socketId);
                if (socket?.userId) {
                    savePlayerProgress(player, socket.userId);
                    savedCount++;
                }
            });
            sendOutput(`Saved ${savedCount} player(s)`, socketId, io);
        }
    }
    else if (trimmedCommand === 'list-players') {
        const playerList = [];
        Object.entries(constants_1.players).forEach(([socketId, player]) => {
            const socket = io.sockets.sockets.get(socketId);
            const username = socket?.username || 'Unknown';
            playerList.push(`Player ID: ${socketId}, Username: ${username}, Nickname: ${player.name}, Level: ${player.level}`);
        });
        if (playerList.length === 0) {
            sendOutput('No players online', socketId, io);
        }
        else {
            sendOutput(`Players (${playerList.length}):`, socketId, io);
            playerList.forEach(msg => sendOutput(msg, socketId, io));
        }
    }
    else if (trimmedCommand === 'list-sockets') {
        const socketList = [];
        io.sockets.sockets.forEach((socket) => {
            socketList.push(`Socket ID: ${socket.id}`);
        });
        if (socketList.length === 0) {
            sendOutput('No sockets connected', socketId, io);
        }
        else {
            sendOutput(`Sockets (${socketList.length}):`, socketId, io);
            socketList.forEach(msg => sendOutput(msg, socketId, io));
        }
    }
    else if (trimmedCommand.startsWith('set_max_enemies')) {
        const newCount = parseInt(trimmedCommand.split(' ')[1]);
        if (!isNaN(newCount) && newCount >= 0) {
            gameState_1.ENEMY_COUNT.value = newCount;
            sendOutput(`Max enemies set to ${gameState_1.ENEMY_COUNT.value}`, socketId, io);
            adjustEnemyCount();
        }
        else {
            sendOutput('Invalid enemy count. Please provide a valid number.', socketId, io);
        }
    }
    else if (trimmedCommand.startsWith('set_bot_count')) {
        const parts = trimmedCommand.split(' ');
        if (parts.length === 2 && parts[1].toLowerCase() === 'default') {
            (0, botManager_1.setTargetBotCount)(null);
            sendOutput('Bot count override cleared (using default formula).', socketId, io);
        }
        else {
            const newCount = parseInt(parts[1]);
            if (isNaN(newCount) || newCount < 0) {
                const current = (0, botManager_1.getTargetBotCount)();
                sendOutput(`Usage: set_bot_count <0-${botManager_1.MAX_BOT_COUNT}|default> — current override: ${current === null ? 'default' : current}`, socketId, io);
            }
            else if (newCount > botManager_1.MAX_BOT_COUNT) {
                sendOutput(`Bot count capped at ${botManager_1.MAX_BOT_COUNT}.`, socketId, io);
            }
            else {
                (0, botManager_1.setTargetBotCount)(newCount);
                sendOutput(`Bot count target set to ${newCount}.`, socketId, io);
            }
        }
    }
    else if (trimmedCommand === 'spawn_special_mobs') {
        spawnSpecialMobs();
        sendOutput('Special mobs spawned', socketId, io);
    }
    else if (trimmedCommand === 'killall' || trimmedCommand === 'kill_all' || trimmedCommand === 'clear_mobs') {
        const removed = clearAllMobs();
        sendOutput(`Killed ${removed} mob${removed === 1 ? '' : 's'} (pets left intact)`, socketId, io);
    }
    else if (trimmedCommand.startsWith('spawn')) {
        const parts = trimmedCommand.split(' ');
        // Grammar (everything after `spawn <mobType> <rarity>` is optional):
        //   spawn <mobType> <rarity>                             -> 1 mob on you
        //   spawn <mobType> <rarity> <amount> [stack|unstack]    -> N mobs on you
        //   spawn <mobType> <rarity> <x> <y>                     -> 1 mob at (x,y)
        //   spawn <mobType> <rarity> <x> <y> <amount> [stack]    -> N mobs at (x,y)
        // With no x/y the mobs spawn on the player who ran the command (or at a
        // random spot when run from the server console/stdin).
        // "stack" piles every copy on one spot; the default (unstacked) offsets
        // them so mob-to-mob collision spreads them apart on spawn.
        const isStackWord = (s) => s !== undefined && ['stack', 'stacked'].includes(s.toLowerCase());
        const isUnstackWord = (s) => s !== undefined && ['unstack', 'unstacked', 'nostack'].includes(s.toLowerCase());
        const isStackFlag = (s) => isStackWord(s) || isUnstackWord(s);
        if (parts.length < 3) {
            sendOutput('Usage: spawn <mobType> <rarity> [x] [y] [amount] [stack|unstack]', socketId, io);
            sendOutput('  No x/y spawns on you (or randomly if run from the server console).', socketId, io);
            sendOutput('  amount: how many to spawn (default 1, max 500). stack piles them on', socketId, io);
            sendOutput('  one spot; the default (unstacked) spreads them via mob collision.', socketId, io);
            sendOutput('  Examples:', socketId, io);
            sendOutput('    spawn bee rare', socketId, io);
            sendOutput('    spawn bee rare 10                (10 bees, spread apart)', socketId, io);
            sendOutput('    spawn bee rare 10 stack          (10 bees in a pile)', socketId, io);
            sendOutput('    spawn bee legendary 1000 2000    (1 bee at 1000,2000)', socketId, io);
            sendOutput('    spawn bee legendary 1000 2000 5  (5 bees at 1000,2000)', socketId, io);
            sendOutput(`Available mob types: ${(0, mobs_1.getAllMobTypes)().join(', ')}`, socketId, io);
            sendOutput('Valid rarities: common, uncommon, rare, epic, legendary, mythic, ultra, super, unique', socketId, io);
        }
        else {
            const mobType = parts[1];
            const rarity = parts[2];
            // Coordinates are present only when parts[3] AND parts[4] are both
            // numbers. `spawn bee rare 10 stack` has a stack word in slot 4, so
            // parts[3] there is an amount, not an x-coordinate.
            const hasCoords = parts.length >= 5 &&
                !isNaN(parseFloat(parts[3])) && !isNaN(parseFloat(parts[4])) &&
                !isStackFlag(parts[4]);
            let x;
            let y;
            let amountTok;
            let stackTok;
            if (hasCoords) {
                x = parseFloat(parts[3]);
                y = parseFloat(parts[4]);
                if (!isSaneCoord(x) || !isSaneCoord(y)) {
                    sendOutput(`Coordinates out of range: (${parts[3]}, ${parts[4]}). Max is ±${constants_1.MAX_SANE_WORLD_COORD}.`, socketId, io);
                    return;
                }
                amountTok = parts[5];
                stackTok = parts[6];
            }
            else {
                amountTok = parts[3];
                stackTok = parts[4];
            }
            // Parse amount (defaults to 1). A stack word in the amount slot means
            // no amount was given (e.g. `spawn bee rare stack`).
            let count = 1;
            if (amountTok !== undefined && !isStackFlag(amountTok)) {
                const parsed = parseInt(amountTok, 10);
                if (isNaN(parsed) || parsed < 1) {
                    sendOutput(`Invalid amount "${amountTok}". Amount must be a positive whole number.`, socketId, io);
                    return;
                }
                count = parsed;
            }
            else if (isStackFlag(amountTok)) {
                // `spawn bee rare stack` — treat the word as the stack flag.
                stackTok = amountTok;
            }
            // Parse stack flag (defaults to unstacked).
            let stack = false;
            if (stackTok !== undefined) {
                if (isStackWord(stackTok))
                    stack = true;
                else if (isUnstackWord(stackTok))
                    stack = false;
                else {
                    sendOutput(`Unknown option "${stackTok}". Expected "stack" or "unstack".`, socketId, io);
                    return;
                }
            }
            // With no explicit coords, spawn on the player who ran the command.
            // From stdin (no associated player) leave coords undefined so spawnMob
            // picks a random valid spot.
            let onExecutor = false;
            if (!hasCoords && socketId && constants_1.players[socketId]) {
                x = constants_1.players[socketId].x;
                y = constants_1.players[socketId].y;
                onExecutor = true;
            }
            spawnMob(mobType, rarity, x, y, count, stack);
            const where = hasCoords ? ` at (${x}, ${y})`
                : onExecutor ? ' at your location'
                    : ' at a random location';
            const many = count > 1 ? `${count}x ` : '';
            const mode = count > 1 ? (stack ? ', stacked' : ', unstacked') : '';
            sendOutput(`Spawned ${many}${rarity} ${mobType}${where}${mode}`, socketId, io);
        }
    }
    else if (trimmedCommand.startsWith('teleport ') || trimmedCommand.startsWith('tp ')) {
        const parts = trimmedCommand.split(' ');
        if (parts.length === 4) {
            // teleport <playerId/name> <x> <y>
            const playerIdentifier = parts[1];
            const x = parseFloat(parts[2]);
            const y = parseFloat(parts[3]);
            if (isNaN(x) || isNaN(y)) {
                sendOutput('Invalid coordinates. Usage: teleport <playerId/name> <x> <y>', socketId, io);
                return;
            }
            if (!isSaneCoord(x) || !isSaneCoord(y)) {
                sendOutput(`Coordinates out of range: (${parts[2]}, ${parts[3]}). Max is ±${constants_1.MAX_SANE_WORLD_COORD}.`, socketId, io);
                return;
            }
            // Try to find player by ID first, then by username
            let targetPlayer;
            let targetPlayerId;
            // Check if it's a socket ID
            if (constants_1.players[playerIdentifier]) {
                targetPlayer = constants_1.players[playerIdentifier];
                targetPlayerId = playerIdentifier;
            }
            else {
                // Search by username
                for (const [sid, player] of Object.entries(constants_1.players)) {
                    const s = io.sockets.sockets.get(sid);
                    if (s?.username && s.username.toLowerCase() === playerIdentifier.toLowerCase()) {
                        targetPlayer = player;
                        targetPlayerId = sid;
                        break;
                    }
                }
            }
            if (targetPlayer && targetPlayerId) {
                // Teleport the player
                targetPlayer.x = x;
                targetPlayer.y = y;
                // Teleporting a maze player out of the region must also drop
                // the maze state — otherwise the per-tick maze clamp pins them
                // at the region border, their inventory stays in maze-shifted
                // rarities, and their level/TP stay on the maze track.
                if (targetPlayer.inMaze && !(0, maze_1.isInMazeRegion)(x, y)) {
                    (0, playerManager_1.exitMazeState)(targetPlayer, io);
                    (0, playerManager_1.recalculatePlayerStats)(targetPlayer, io);
                }
                // Emit teleport event to client for visual effects. A splitter
                // half owns no socket — address the client that drives it.
                io.to((0, utils_1.getOriginalSocketId)(targetPlayerId)).emit('playerTeleported', {
                    newX: x,
                    newY: y,
                    playerId: targetPlayerId
                });
                sendOutput(`Teleported player ${targetPlayer.name} (${targetPlayerId}) to (${x}, ${y})`, socketId, io);
            }
            else {
                sendOutput(`Player "${playerIdentifier}" not found. Use list-players to see available players.`, socketId, io);
            }
        }
        else {
            sendOutput('Usage: teleport <playerId/username> <x> <y>', socketId, io);
            sendOutput('  Examples:', socketId, io);
            sendOutput('    teleport abc123 1000 2000', socketId, io);
            sendOutput('    teleport Username 5000 3000', socketId, io);
            sendOutput('    tp abc123 1000 2000  (shorthand)', socketId, io);
        }
    }
    else if (trimmedCommand.startsWith('teleport_all ') || trimmedCommand.startsWith('tpall ')
        || trimmedCommand === 'teleport_all' || trimmedCommand === 'tpall') {
        // teleport_all <x> <y> — move every real player (bots excluded) to one spot.
        const parts = trimmedCommand.split(' ');
        if (parts.length !== 3) {
            sendOutput('Usage: teleport_all <x> <y>', socketId, io);
            sendOutput('  Teleports every online player (bots excluded) to (x, y).', socketId, io);
            sendOutput('  Example: teleport_all 1000 2000   (tpall works too)', socketId, io);
            return;
        }
        const x = parseFloat(parts[1]);
        const y = parseFloat(parts[2]);
        if (isNaN(x) || isNaN(y)) {
            sendOutput('Invalid coordinates. Usage: teleport_all <x> <y>', socketId, io);
            return;
        }
        if (!isSaneCoord(x) || !isSaneCoord(y)) {
            sendOutput(`Coordinates out of range: (${parts[1]}, ${parts[2]}). Max is ±${constants_1.MAX_SANE_WORLD_COORD}.`, socketId, io);
            return;
        }
        let moved = 0;
        for (const [pid, player] of Object.entries(constants_1.players)) {
            if ((0, botManager_1.isBot)(pid))
                continue;
            player.x = x;
            player.y = y;
            // Same maze-exit rule as single teleport: dragging a maze player out
            // of the region must drop maze state or the per-tick clamp pins them
            // at the border with maze-shifted inventory/level.
            if (player.inMaze && !(0, maze_1.isInMazeRegion)(x, y)) {
                (0, playerManager_1.exitMazeState)(player, io);
                (0, playerManager_1.recalculatePlayerStats)(player, io);
            }
            // A splitter half owns no socket — address the client that drives it.
            io.to((0, utils_1.getOriginalSocketId)(pid)).emit('playerTeleported', {
                newX: x,
                newY: y,
                playerId: pid
            });
            moved++;
        }
        sendOutput(`Teleported ${moved} player${moved === 1 ? '' : 's'} to (${x}, ${y})`, socketId, io);
    }
    else if (trimmedCommand === 'change-maze' || trimmedCommand.startsWith('change-maze ')
        || trimmedCommand === 'change_maze' || trimmedCommand.startsWith('change_maze ')) {
        // change-maze [next|garden|desert|ocean|<dayNumber>] — force a new maze
        // immediately (new layout, mobs cleared, players inside moved to the new
        // entrance, all clients rebuilt via 'mazeInfo').
        const arg = trimmedCommand.split(' ').slice(1).join(' ');
        sendOutput((0, server_1.adminChangeMaze)(arg), socketId, io);
    }
    else if (trimmedCommand.startsWith('set_skin ')) {
        // set_skin <playerId/username> <skinName|bitmask|none>
        // Sets the player's renderFlags, which the broadcast sends to every client
        // so the custom skin (graphics/player-skins.ts) replaces their flower render.
        const skinNames = Object.keys(player_1.PlayerRenderFlags).filter(k => isNaN(Number(k)));
        const parts = trimmedCommand.split(' ');
        if (parts.length !== 3) {
            sendOutput(`Usage: set_skin <playerId/username> <${skinNames.join('|')}|none|bitmask>`, socketId, io);
            return;
        }
        const playerIdentifier = parts[1];
        const skinArg = parts[2];
        // Resolve the requested skin to a renderFlags bitmask (name, "none", or number).
        let renderFlags;
        if (skinArg.toLowerCase() === 'none') {
            renderFlags = 0;
        }
        else {
            const matchedKey = skinNames.find(k => k.toLowerCase() === skinArg.toLowerCase());
            if (matchedKey) {
                renderFlags = player_1.PlayerRenderFlags[matchedKey];
            }
            else {
                const numeric = parseInt(skinArg);
                renderFlags = isNaN(numeric) || numeric < 0 ? null : numeric;
            }
        }
        if (renderFlags === null) {
            sendOutput(`Unknown skin "${skinArg}". Available: ${skinNames.join(', ')}, none, or a numeric bitmask.`, socketId, io);
            return;
        }
        // Find player by socket ID first, then by username.
        let targetPlayer;
        let targetSocket;
        if (constants_1.players[playerIdentifier]) {
            targetPlayer = constants_1.players[playerIdentifier];
            targetSocket = io.sockets.sockets.get(playerIdentifier);
        }
        else {
            for (const [sid, player] of Object.entries(constants_1.players)) {
                const s = io.sockets.sockets.get(sid);
                if (s?.username && s.username.toLowerCase() === playerIdentifier.toLowerCase()) {
                    targetPlayer = player;
                    targetSocket = s;
                    break;
                }
            }
        }
        if (targetPlayer) {
            targetPlayer.renderFlags = renderFlags;
            // Persist immediately so the skin is saved as account content (survives
            // logout) rather than waiting for the next debounced save.
            if (targetSocket?.userId)
                savePlayerProgress(targetPlayer, targetSocket.userId);
            sendOutput(`Set ${targetPlayer.name}'s renderFlags to ${renderFlags}${renderFlags === 0 ? ' (default flower)' : ''}`, socketId, io);
        }
        else {
            sendOutput(`Player "${playerIdentifier}" not found. Use list-players to see available players.`, socketId, io);
        }
    }
    else if (trimmedCommand === 'corrupt' || trimmedCommand.startsWith('corrupt ')) {
        // corrupt <playerId/username> [on|off|toggle]
        // Corrupts a flower: it turns dark red (FaceFlags.HasCorruption) and its
        // petals damage OTHER PLAYERS anywhere in the world, not just inside the
        // PVP arena — and theirs damage it back (canPetalsDamagePlayer). Mob
        // combat is untouched, so a corrupted flower fights both.
        const parts = trimmedCommand.split(' ').filter(p => p.length > 0);
        if (parts.length < 2 || parts.length > 3) {
            sendOutput('Usage: corrupt <playerId/username> [on|off|toggle]  (default: toggle)', socketId, io);
            return;
        }
        const playerIdentifier = parts[1];
        const modeArg = (parts[2] || 'toggle').toLowerCase();
        if (!['on', 'off', 'toggle'].includes(modeArg)) {
            sendOutput(`Unknown mode "${modeArg}". Use on, off or toggle.`, socketId, io);
            return;
        }
        // Same resolution as set_skin: socket id first, then username.
        let targetPlayer;
        if (constants_1.players[playerIdentifier]) {
            targetPlayer = constants_1.players[playerIdentifier];
        }
        else {
            for (const [sid, player] of Object.entries(constants_1.players)) {
                const s = io.sockets.sockets.get(sid);
                if (s?.username && s.username.toLowerCase() === playerIdentifier.toLowerCase()) {
                    targetPlayer = player;
                    break;
                }
            }
        }
        if (!targetPlayer) {
            sendOutput(`Player "${playerIdentifier}" not found. Use list-players to see available players.`, socketId, io);
            return;
        }
        const corrupted = modeArg === 'toggle' ? !targetPlayer.corrupted : modeArg === 'on';
        // A splitter's two halves are one person: corrupt (or clean) both, or the
        // clone would keep fighting under the other half's rules.
        const split = petal_actions_1.splitPlayers.get((0, utils_1.getOriginalSocketId)(targetPlayer.id));
        const halves = split ? [split.player1, split.player2] : [targetPlayer];
        for (const half of halves) {
            if (constants_1.players[half.id])
                (0, gameState_1.setPlayerCorrupted)(constants_1.players[half.id], corrupted);
        }
        sendOutput(`${corrupted ? 'Corrupted' : 'Cleansed'} ${targetPlayer.name} (${targetPlayer.id})`
            + (halves.length > 1 ? ' and their splitter half' : ''), socketId, io);
    }
    else if (trimmedCommand === 'grant_admin' || trimmedCommand.startsWith('grant_admin ')
        || trimmedCommand === 'revoke_admin' || trimmedCommand.startsWith('revoke_admin ')) {
        // grant_admin <playerId/username> — lend the admin console to another
        // player for their current life. See server/tempAdmin.ts for what the
        // grant does and does not unlock; it expires on respawn, on returning to
        // the title screen, and on disconnect.
        const parts = trimmedCommand.split(' ').filter(p => p.length > 0);
        const granting = parts[0] === 'grant_admin';
        // Only a real (database-flagged) admin may hand out or take back grants —
        // otherwise a grantee could keep the chain alive past their own respawn.
        // An `executor` of undefined means the server console, which is trusted.
        if (executor && !database_1.database.isUserAdmin(executor)) {
            sendOutput('Only a full admin can grant or revoke admin access.', socketId, io);
            return;
        }
        if (parts.length !== 2) {
            sendOutput(`Usage: ${parts[0]} <playerId/username>`, socketId, io);
            return;
        }
        // Same resolution as corrupt/set_skin: socket id first, then username.
        const playerIdentifier = parts[1];
        let targetId;
        let targetPlayer;
        if (constants_1.players[playerIdentifier]) {
            targetId = playerIdentifier;
            targetPlayer = constants_1.players[playerIdentifier];
        }
        else {
            for (const [sid, player] of Object.entries(constants_1.players)) {
                const s = io.sockets.sockets.get(sid);
                if (s?.username && s.username.toLowerCase() === playerIdentifier.toLowerCase()) {
                    targetId = sid;
                    targetPlayer = player;
                    break;
                }
            }
        }
        if (!targetId || !targetPlayer) {
            sendOutput(`Player "${playerIdentifier}" not found. Use list-players to see available players.`, socketId, io);
            return;
        }
        // Grants live on the original socket, so a splitter's two halves share one.
        const grantId = (0, utils_1.getOriginalSocketId)(targetId);
        const targetSocket = io.sockets.sockets.get(grantId);
        const targetName = targetSocket?.username || targetPlayer.name;
        const notifyTarget = (content) => {
            io.to(grantId).emit('chatMessage', {
                sender: 'System',
                content,
                timestamp: Date.now()
            });
        };
        if (granting) {
            if (targetSocket?.username && database_1.database.isUserAdmin(targetSocket.username)) {
                sendOutput(`${targetName} is already a full admin.`, socketId, io);
                return;
            }
            if ((0, tempAdmin_1.hasTempAdmin)(grantId)) {
                sendOutput(`${targetName} already has a temporary admin grant.`, socketId, io);
                return;
            }
            (0, tempAdmin_1.grantTempAdmin)(grantId, executor || 'console');
            notifyTarget('<span style="color: #ffb74d;">You have been granted admin commands until you respawn. Use /admin &lt;command&gt; or /help.</span>');
            sendOutput(`Granted temporary admin to ${targetName} (${grantId}) until they respawn.`, socketId, io);
        }
        else {
            if (!(0, tempAdmin_1.revokeTempAdmin)(grantId)) {
                sendOutput(`${targetName} has no temporary admin grant.`, socketId, io);
                return;
            }
            notifyTarget('<span style="color: #ff8866;">Your temporary admin access has been revoked.</span>');
            sendOutput(`Revoked temporary admin from ${targetName} (${grantId}).`, socketId, io);
        }
    }
    else if (trimmedCommand === 'list_admins') {
        // Only the temporary grants are listed — permanent admins are in the DB.
        const entries = (0, tempAdmin_1.listTempAdmins)();
        if (entries.length === 0) {
            sendOutput('No temporary admin grants are active.', socketId, io);
        }
        else {
            sendOutput(`Temporary admins (${entries.length}):`, socketId, io);
            for (const { socketId: grantId, grant } of entries) {
                const s = io.sockets.sockets.get(grantId);
                const name = s?.username || constants_1.players[grantId]?.name || 'Unknown';
                const ageSec = Math.round((Date.now() - grant.grantedAt) / 1000);
                sendOutput(`${name} (${grantId}) — granted by ${grant.grantedBy}, ${ageSec}s ago`, socketId, io);
            }
        }
    }
    else if (trimmedCommand === 'mute' || trimmedCommand.startsWith('mute ')
        || trimmedCommand === 'unmute' || trimmedCommand.startsWith('unmute ')) {
        // mute/unmute <playerId/username> — bar an account from chat. The flag is
        // persisted on the user record (see server/chatMute.ts), so it outlives
        // the session and works on players who are currently offline.
        const parts = trimmedCommand.split(' ').filter(p => p.length > 0);
        const muting = parts[0] === 'mute';
        if (parts.length !== 2) {
            sendOutput(`Usage: ${parts[0]} <playerId/username>`, socketId, io);
            return;
        }
        // Same resolution as corrupt/grant_admin: socket id first, then the
        // username of an online player. An offline account still resolves below,
        // straight out of the database.
        const playerIdentifier = parts[1];
        let targetSocketId;
        let targetUsername;
        if (constants_1.players[playerIdentifier]) {
            targetSocketId = playerIdentifier;
            targetUsername = io.sockets.sockets.get((0, utils_1.getOriginalSocketId)(playerIdentifier))?.username;
        }
        else {
            for (const sid of Object.keys(constants_1.players)) {
                const s = io.sockets.sockets.get(sid);
                if (s?.username && s.username.toLowerCase() === playerIdentifier.toLowerCase()) {
                    targetSocketId = sid;
                    targetUsername = s.username;
                    break;
                }
            }
            if (!targetUsername)
                targetUsername = playerIdentifier;
        }
        if (!targetUsername) {
            sendOutput(`Could not resolve an account for "${playerIdentifier}" (bots have no account and cannot chat).`, socketId, io);
            return;
        }
        // Everything below keys off the stored spelling, so a name typed with the
        // wrong casing can't slip past the admin check or split the flag across
        // two spellings.
        const canonical = database_1.database.getCanonicalUsername(targetUsername);
        if (!canonical) {
            sendOutput(`No account named "${targetUsername}" exists. Use list-players to see online players.`, socketId, io);
            return;
        }
        // Muting a full admin is refused so a temporary grantee can't silence the
        // admin who lent them the console.
        if (muting && database_1.database.isUserAdmin(canonical)) {
            sendOutput(`${canonical} is a full admin and cannot be muted.`, socketId, io);
            return;
        }
        if (muting === database_1.database.isUserMuted(canonical)) {
            sendOutput(`${canonical} is already ${muting ? 'muted' : 'not muted'}.`, socketId, io);
            return;
        }
        database_1.database.setUserMuted(canonical, muting, executor || 'console');
        if (targetSocketId) {
            io.to((0, utils_1.getOriginalSocketId)(targetSocketId)).emit('chatMessage', {
                sender: 'System',
                content: muting
                    ? '<span style="color: #ff8866;">You have been muted by an admin and can no longer send chat messages.</span>'
                    : '<span style="color: #6eff6e;">You have been unmuted and can send chat messages again.</span>',
                timestamp: Date.now()
            });
        }
        sendOutput(`${muting ? 'Muted' : 'Unmuted'} ${canonical}${targetSocketId ? '' : ' (offline)'}.`, socketId, io);
    }
    else if (trimmedCommand.startsWith('generate_code') || trimmedCommand.startsWith('gen_code')) {
        // generate_code <stars> [maxUses] (default maxUses is 1)
        const parts = trimmedCommand.split(' ');
        if (parts.length >= 2) {
            const stars = parseInt(parts[1]);
            // Default maxUses to 1 if not specified, or -1 for unlimited if explicitly set to 0
            let maxUses = 1; // Default to 1
            if (parts.length >= 3) {
                const maxUsesInput = parseInt(parts[2]);
                if (maxUsesInput === 0) {
                    maxUses = undefined; // 0 means unlimited
                }
                else if (!isNaN(maxUsesInput) && maxUsesInput > 0) {
                    maxUses = maxUsesInput;
                }
            }
            if (isNaN(stars) || stars <= 0) {
                sendOutput('Invalid stars amount. Usage: generate_code <stars> [maxUses]', socketId, io);
                sendOutput('  Default maxUses is 1. Use 0 for unlimited.', socketId, io);
                return;
            }
            // Generate a unique code
            let code;
            let attempts = 0;
            do {
                code = generateCode();
                attempts++;
                if (attempts > 100) {
                    sendOutput('Failed to generate unique code after 100 attempts', socketId, io);
                    return;
                }
            } while (server_1.redeemedCodes.has(code));
            // Create the code entry
            const codeData = {
                code: code,
                stars: stars,
                maxUses: maxUses,
                uses: 0,
                usedBy: [],
                createdBy: executor,
                createdAt: Date.now()
            };
            server_1.redeemedCodes.set(code, codeData);
            (0, server_1.saveCodeToDatabase)(code, codeData);
            sendOutput('[CODE GENERATED]', socketId, io);
            sendOutput(`Code: ${code}`, socketId, io);
            sendOutput(`Stars: ${stars}`, socketId, io);
            if (maxUses) {
                sendOutput(`Max Uses: ${maxUses}`, socketId, io);
            }
            else {
                sendOutput('Max Uses: Unlimited', socketId, io);
            }
            sendOutput(`Created by: ${executor || 'Console'}`, socketId, io);
            sendOutput('Players can redeem this code in the shop!', socketId, io);
        }
        else {
            sendOutput('Usage: generate_code <stars> [maxUses]', socketId, io);
            sendOutput('  Default maxUses is 1. Use 0 for unlimited.', socketId, io);
            sendOutput('  Examples:', socketId, io);
            sendOutput('    generate_code 100  (single use)', socketId, io);
            sendOutput('    generate_code 500 10  (max 10 uses)', socketId, io);
            sendOutput('    generate_code 1000 0  (unlimited uses)', socketId, io);
            sendOutput('    gen_code 1000  (shorthand, single use)', socketId, io);
        }
    }
    else if (trimmedCommand === 'list_codes') {
        if (server_1.redeemedCodes.size === 0) {
            sendOutput('No codes have been generated.', socketId, io);
        }
        else {
            sendOutput(`[GENERATED CODES] (${server_1.redeemedCodes.size} total)`, socketId, io);
            server_1.redeemedCodes.forEach((codeData, code) => {
                sendOutput(`Code: ${code}`, socketId, io);
                sendOutput(`  Stars: ${codeData.stars}`, socketId, io);
                sendOutput(`  Uses: ${codeData.uses}${codeData.maxUses ? `/${codeData.maxUses}` : ' (unlimited)'}`, socketId, io);
                sendOutput(`  Created by: ${codeData.createdBy || 'Unknown'}`, socketId, io);
                if (codeData.createdAt) {
                    const date = new Date(codeData.createdAt);
                    sendOutput(`  Created: ${date.toLocaleString()}`, socketId, io);
                }
            });
        }
    }
    else if (trimmedCommand.startsWith('delete_code ')) {
        const parts = trimmedCommand.split(' ');
        if (parts.length === 2) {
            const code = parts[1].toUpperCase();
            if (server_1.redeemedCodes.has(code)) {
                server_1.redeemedCodes.delete(code);
                (0, server_1.deleteCodeFromDatabase)(code);
                sendOutput(`Code ${code} has been deleted.`, socketId, io);
            }
            else {
                sendOutput(`Code ${code} not found.`, socketId, io);
            }
        }
        else {
            sendOutput('Usage: delete_code <code>', socketId, io);
        }
    }
    else if (trimmedCommand.startsWith('notification ') || trimmedCommand.startsWith('notify ')) {
        // notification <type> <message> or notify <type> <message>
        const parts = trimmedCommand.split(' ');
        if (parts.length >= 3) {
            const type = parts[1].toLowerCase();
            const message = parts.slice(2).join(' '); // Join remaining parts as message
            // Validate type
            const validTypes = ['super_craft', 'unique_craft', 'apex_craft', 'star_code'];
            if (!validTypes.includes(type)) {
                sendOutput(`Invalid notification type. Valid types: ${validTypes.join(', ')}`, socketId, io);
                return;
            }
            // Create notification
            const notification = {
                id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
                type: type,
                message: message,
                timestamp: Date.now()
            };
            database_1.database.addNotification(notification);
            sendOutput(`Notification created: ${message}`, socketId, io);
        }
        else {
            sendOutput('Usage: notification <type> <message>', socketId, io);
            sendOutput('  Or: notify <type> <message> (shorthand)', socketId, io);
            sendOutput('  Valid types: super_craft, unique_craft, apex_craft, star_code', socketId, io);
            sendOutput('  Examples:', socketId, io);
            sendOutput('    notification star_code Special event starting now!', socketId, io);
            sendOutput('    notify unique_craft New unique petal discovered!', socketId, io);
        }
    }
    else if (trimmedCommand === 'clear_notifications' || trimmedCommand === 'clear_notifs') {
        const count = database_1.database.clearAllNotifications();
        sendOutput(`Cleared ${count} notification(s)`, socketId, io);
    }
    else if (trimmedCommand.startsWith('give ')) {
        const parts = trimmedCommand.split(' ');
        if (parts.length === 4 || parts.length === 5) {
            // give <playerId/name> <itemType> <rarity> [amount]
            const playerIdentifier = parts[1];
            const itemType = parts[2].toLowerCase();
            const rarity = parts[3].toLowerCase();
            // Parse optional amount (defaults to 1).
            let amount = 1;
            if (parts.length === 5) {
                const parsed = parseInt(parts[4], 10);
                if (isNaN(parsed) || parsed < 1) {
                    sendOutput(`Invalid amount "${parts[4]}". Amount must be a positive whole number.`, socketId, io);
                    return;
                }
                amount = parsed;
            }
            // Validate rarity
            if (!petals_1.RARITY_LEVELS.includes(rarity)) {
                sendOutput(`Invalid rarity. Valid rarities: ${petals_1.RARITY_LEVELS.join(', ')}`, socketId, io);
                return;
            }
            // Try to find player by ID first, then by username
            let targetPlayer;
            let targetPlayerId;
            let targetSocket;
            // Check if it's a socket ID
            if (constants_1.players[playerIdentifier]) {
                targetPlayer = constants_1.players[playerIdentifier];
                targetPlayerId = playerIdentifier;
                targetSocket = io.sockets.sockets.get(playerIdentifier);
            }
            else {
                // Search by username
                for (const [sid, player] of Object.entries(constants_1.players)) {
                    const s = io.sockets.sockets.get(sid);
                    if (s?.username && s.username.toLowerCase() === playerIdentifier.toLowerCase()) {
                        targetPlayer = player;
                        targetPlayerId = sid;
                        targetSocket = s;
                        break;
                    }
                }
            }
            // Check if it's a consumable item
            const consumableTypes = ['health_potion', 'speed_boost', 'shield'];
            let itemKey;
            let itemDisplayName;
            if (consumableTypes.includes(itemType)) {
                // It's a consumable
                itemKey = itemType;
                itemDisplayName = itemType;
            }
            else {
                // It's a petal - validate it exists and has the specified rarity
                const petalStats = (0, petals_1.getPetalStats)(itemType, rarity);
                if (!petalStats) {
                    sendOutput(`Petal type "${itemType}" does not exist or does not have rarity "${rarity}"`, socketId, io);
                    return;
                }
                itemKey = `petal_${itemType}`;
                itemDisplayName = `${itemType} petal`;
            }
            if (targetPlayer && targetPlayerId) {
                // Add item to player's inventory. The inventory is always in
                // regular-world terms — even inside the maze (only the locked
                // loadout shifts) — so the given rarity is stored literally.
                (0, playerManager_1.addItem)(targetPlayer.inventory, rarity, itemKey, amount);
                // Emit inventory update to the player
                if (targetSocket) {
                    io.to((0, utils_1.getOriginalSocketId)(targetPlayerId)).emit('inventoryUpdated', targetPlayer.inventory);
                }
                // Save player progress if user is authenticated
                if (targetSocket?.userId) {
                    savePlayerProgress(targetPlayer, targetSocket.userId);
                }
                const amountLabel = amount > 1 ? `${amount}x ` : '';
                sendOutput(`Gave ${amountLabel}${rarity} ${itemDisplayName} to ${targetPlayer.name} (${targetPlayerId})`, socketId, io);
            }
            else {
                // Not connected right now — write straight to the persisted account so
                // `give` also works for offline players. Their live inventory (if any)
                // gets rebuilt from this saved data the next time they connect.
                const offlineUserId = database_1.database.getUserIdByUsername(playerIdentifier);
                if (offlineUserId) {
                    const progress = database_1.database.getPlayerByUserId(offlineUserId) || { totalXP: 0 };
                    if (!progress.inventory)
                        progress.inventory = {};
                    if (!progress.inventory[rarity])
                        progress.inventory[rarity] = {};
                    progress.inventory[rarity][itemKey] = (progress.inventory[rarity][itemKey] || 0) + amount;
                    database_1.database.savePlayer(offlineUserId, progress);
                    const amountLabel = amount > 1 ? `${amount}x ` : '';
                    sendOutput(`Gave ${amountLabel}${rarity} ${itemDisplayName} to ${playerIdentifier} (offline)`, socketId, io);
                }
                else {
                    sendOutput(`Player "${playerIdentifier}" not found. Use list-players to see online players, or double-check the username for offline accounts.`, socketId, io);
                }
            }
        }
        else {
            sendOutput('Usage: give <playerId/username> <itemType> <rarity> [amount]', socketId, io);
            sendOutput('  amount: how many to give (default 1).', socketId, io);
            sendOutput('  Works for online players (by socket id or username) and offline', socketId, io);
            sendOutput('  accounts (by username) — offline gives are saved directly to the account.', socketId, io);
            sendOutput('  Examples:', socketId, io);
            sendOutput('    give abc123 basic rare', socketId, io);
            sendOutput('    give Username rose legendary 5', socketId, io);
            sendOutput('    give abc123 health_potion epic 10', socketId, io);
            sendOutput('  Item types:', socketId, io);
            sendOutput('    Petals: any petal type (e.g., basic, rose, stinger)', socketId, io);
            sendOutput('    Consumables: health_potion, speed_boost, shield', socketId, io);
            sendOutput(`  Valid rarities: ${petals_1.RARITY_LEVELS.join(', ')}`, socketId, io);
        }
    }
    else if (trimmedCommand.startsWith('guild_force_join') || trimmedCommand.startsWith('guild_force') || trimmedCommand.startsWith('guild-force-join')) {
        // Admins reference guilds by name. Guild names can contain spaces, so parse
        // as: <command> <guild name tokens...> <username>. The last whitespace-
        // separated token is the username; everything in between is the guild name.
        const rest = trimmedCommand.replace(/^(guild_force_join|guild_force|guild-force-join)\s*/, '');
        const tokens = rest.trim().split(/\s+/).filter(t => t.length > 0);
        if (tokens.length < 2) {
            sendOutput('Usage: guild_force_join <guild name> <username>', socketId, io);
        }
        else {
            const targetUsername = tokens[tokens.length - 1];
            const guildName = tokens.slice(0, -1).join(' ');
            const { guild, prevGuild, error } = (0, guildManager_1.forceJoinGuild)(guildName, targetUsername);
            if (error || !guild) {
                sendOutput(error || 'Force-join failed.', socketId, io);
            }
            else {
                sendOutput(`Force-joined ${targetUsername} into guild "${guild.name}".`, socketId, io);
                if (prevGuild && prevGuild.name !== guild.name) {
                    (0, guildManager_1.broadcastGuildUpdate)(prevGuild, io);
                }
                (0, guildManager_1.syncGuildToOnlineMembers)([targetUsername], guild, io);
                (0, guildManager_1.broadcastGuildUpdate)(guild, io);
                (0, guildManager_1.sendGuildSystemMessage)(guild, io, `${targetUsername} was added to the guild by an admin.`);
                const targetSid = (0, guildManager_1.findSocketIdByUsername)(targetUsername, io);
                if (targetSid) {
                    io.to(targetSid).emit('chatMessage', {
                        sender: 'System',
                        content: `<span style="color: #ffb74d;">You were added to guild "${guild.name}" by an admin.</span>`,
                        timestamp: Date.now()
                    });
                }
            }
        }
    }
    else if (trimmedCommand === 'guild_list' || trimmedCommand === 'list_guilds') {
        const all = (0, guildManager_1.listGuilds)();
        if (all.length === 0) {
            sendOutput('No guilds exist.', socketId, io);
        }
        else {
            sendOutput(`Guilds (${all.length}):`, socketId, io);
            all.forEach(g => {
                sendOutput(`  "${g.name}" — ${g.memberUsernames.length}/${guildManager_1.MAX_GUILD_SIZE} — leader @${g.leaderUsername}`, socketId, io);
            });
        }
    }
    else if (trimmedCommand.startsWith('guild_info') || trimmedCommand.startsWith('guild-info')) {
        const name = trimmedCommand.replace(/^(guild_info|guild-info)\s*/, '').trim();
        if (!name) {
            sendOutput('Usage: guild_info <guild name>', socketId, io);
        }
        else {
            const g = (0, guildManager_1.getGuildByName)(name);
            if (!g) {
                sendOutput(`Guild "${name}" not found.`, socketId, io);
            }
            else {
                sendOutput(`"${g.name}" — leader @${g.leaderUsername} — ${g.memberUsernames.length}/${guildManager_1.MAX_GUILD_SIZE}`, socketId, io);
                sendOutput(`Members: ${g.memberUsernames.join(', ')}`, socketId, io);
            }
        }
    }
    else if (trimmedCommand === 'delete_guests') {
        const count = database_1.database.deleteGuestAccounts();
        sendOutput(`Deleted ${count} guest account(s) and their player data.`, socketId, io);
    }
    else if (trimmedCommand === 'list_today_logins' || trimmedCommand === 'list_active') {
        const active = database_1.database.getTodayLogins();
        if (active.length === 0) {
            sendOutput('No accounts active in the last 24 hours.', socketId, io);
        }
        else {
            sendOutput(`Accounts active in last 24 hours (${active.length}):`, socketId, io);
            const now = Date.now();
            active.forEach(({ username, lastActiveAt }) => {
                const minutesAgo = Math.floor((now - lastActiveAt) / 60000);
                const when = minutesAgo < 1
                    ? 'just now'
                    : minutesAgo < 60
                        ? `${minutesAgo}m ago`
                        : `${Math.floor(minutesAgo / 60)}h ${minutesAgo % 60}m ago`;
                sendOutput(`  ${username} — ${when}`, socketId, io);
            });
        }
    }
    else if (trimmedCommand === 'backup_db' || trimmedCommand.startsWith('backup_db ')
        || trimmedCommand === 'db_backup' || trimmedCommand.startsWith('db_backup ')) {
        // backup_db        -> snapshot the database to db_backups/ (outside dist/)
        // backup_db list   -> list existing backups, newest first
        const arg = trimmedCommand.replace(/^(backup_db|db_backup)\s*/, '').trim();
        if (arg === 'list') {
            const backups = database_1.database.listDatabaseBackups();
            if (backups.length === 0) {
                sendOutput('No database backups yet. Run "backup_db" to create one.', socketId, io);
            }
            else {
                sendOutput(`Database backups (${backups.length}, newest first):`, socketId, io);
                backups.forEach(b => {
                    sendOutput(`  ${b.file} — ${(b.bytes / 1024).toFixed(1)} KB — ${new Date(b.mtimeMs).toLocaleString()}`, socketId, io);
                });
                sendOutput('To restore: copy a backup over inventory.json (in dist/) and restart the server.', socketId, io);
            }
        }
        else if (arg === '') {
            try {
                const result = database_1.database.backupDatabase(executor ? `manual-${executor}` : 'manual');
                sendOutput(`Database backed up to ${result.file} (${(result.bytes / 1024).toFixed(1)} KB)`, socketId, io);
            }
            catch (error) {
                const msg = error instanceof Error ? error.message : String(error);
                sendOutput(`Database backup FAILED: ${msg}`, socketId, io);
            }
        }
        else {
            sendOutput('Usage: backup_db [list]', socketId, io);
        }
    }
    else if (trimmedCommand === 'update' || trimmedCommand.startsWith('update ')) {
        // update                  -> backup DB, install latest build, restart in 60s
        // update now              -> same, restart immediately
        // update <N>(s|m|h)       -> same, restart after the given delay
        // update status           -> show current/last update state
        // update cancel           -> cancel the pending post-update restart
        // The database is ALWAYS backed up first; if the backup fails the
        // update aborts before touching anything.
        const arg = trimmedCommand.slice('update'.length).trim();
        if (arg === 'status') {
            sendOutput((0, autoUpdate_1.isUpdateInProgress)() ? `Update in progress. ${(0, autoUpdate_1.getLastUpdateStatus)()}` : (0, autoUpdate_1.getLastUpdateStatus)(), socketId, io);
            const info = (0, server_1.getScheduledRestartInfo)();
            if (info?.reason === 'update') {
                sendOutput(`Post-update restart in ${Math.ceil(info.remainingMs / 1000)}s.`, socketId, io);
            }
        }
        else if (arg === 'cancel' || arg === 'abort') {
            if ((0, autoUpdate_1.isUpdateInProgress)()) {
                sendOutput('Update is mid-install and cannot be cancelled (it only takes a few seconds).', socketId, io);
            }
            else if ((0, server_1.getScheduledRestartInfo)()?.reason === 'update' && (0, server_1.cancelScheduledRestart)()) {
                sendOutput('Post-update restart cancelled. The new build is already on disk and will load on the next restart.', socketId, io);
            }
            else {
                sendOutput('No pending post-update restart to cancel.', socketId, io);
            }
        }
        else if (arg === 'help' || arg === '?') {
            sendOutput('Usage: update [now|<N>(s|m|h)|status|cancel]', socketId, io);
            sendOutput('  Backs up the database FIRST (aborts if that fails), downloads the latest', socketId, io);
            sendOutput('  build (dist/) from the GitHub repo, installs it over the running server', socketId, io);
            sendOutput('  (inventory.json is never touched), then restarts. Default restart delay', socketId, io);
            sendOutput('  is 60s so players get warned.', socketId, io);
        }
        else {
            // '', 'now', or a delay — same duration grammar as `restart`.
            let delayMs = 60 * 1000;
            if (arg === 'now') {
                delayMs = 0;
            }
            else if (arg !== '') {
                const match = arg.match(/^(\d+)\s*(s|sec|secs|m|min|mins|h|hr|hrs)?$/i);
                if (!match) {
                    sendOutput('Usage: update [now|<N>(s|m|h)|status|cancel]', socketId, io);
                    return;
                }
                const n = parseInt(match[1], 10);
                const unit = (match[2] || 's').toLowerCase();
                delayMs = unit.startsWith('h') ? n * 60 * 60 * 1000
                    : unit.startsWith('m') ? n * 60 * 1000
                        : n * 1000;
            }
            if ((0, autoUpdate_1.isUpdateInProgress)()) {
                sendOutput('An update is already in progress. Use "update status" to check on it.', socketId, io);
                return;
            }
            (0, autoUpdate_1.runAutoUpdate)({
                report: (msg) => sendOutput(msg, socketId, io),
                restartDelayMs: delayMs,
            }).catch((error) => {
                const msg = error instanceof Error ? error.message : String(error);
                sendOutput(`[UPDATE] FAILED: ${msg}`, socketId, io);
            });
        }
    }
    else if (trimmedCommand === 'restart' || trimmedCommand.startsWith('restart ')) {
        // restart                       -> default 60s
        // restart <seconds>             -> seconds
        // restart <number>(s|m|h)       -> with unit
        // restart cancel                -> cancel pending restart
        // restart status                -> show pending restart info
        const arg = trimmedCommand.slice('restart'.length).trim();
        if (arg === 'status' || arg === '') {
            if (arg === '') {
                // No arg = schedule default 60s
                const ok = (0, server_1.scheduleRestart)(60 * 1000, 'admin');
                if (ok)
                    sendOutput('Restart scheduled in 60 seconds. Use "restart cancel" to abort.', socketId, io);
                else
                    sendOutput('Cannot schedule: a restart is already firing.', socketId, io);
            }
            else {
                const info = (0, server_1.getScheduledRestartInfo)();
                if (!info)
                    sendOutput('No restart scheduled.', socketId, io);
                else {
                    const m = Math.floor(info.remainingMs / 60000);
                    const s = Math.floor((info.remainingMs % 60000) / 1000);
                    sendOutput(`Restart scheduled in ${m}m ${s}s (reason: ${info.reason}).`, socketId, io);
                }
            }
        }
        else if (arg === 'cancel' || arg === 'abort') {
            const ok = (0, server_1.cancelScheduledRestart)();
            sendOutput(ok ? 'Pending restart cancelled.' : 'No pending restart to cancel.', socketId, io);
        }
        else {
            // Parse number with optional s/m/h suffix
            const match = arg.match(/^(\d+)\s*(s|sec|secs|m|min|mins|h|hr|hrs)?$/i);
            if (!match) {
                sendOutput('Usage: restart [<seconds>|<N>(s|m|h)|cancel|status]', socketId, io);
            }
            else {
                const n = parseInt(match[1], 10);
                const unit = (match[2] || 's').toLowerCase();
                let ms = n * 1000;
                if (unit.startsWith('m') && !unit.startsWith('ms'))
                    ms = n * 60 * 1000;
                else if (unit.startsWith('h'))
                    ms = n * 60 * 60 * 1000;
                if (ms < 0 || !Number.isFinite(ms)) {
                    sendOutput('Invalid duration.', socketId, io);
                }
                else {
                    const ok = (0, server_1.scheduleRestart)(ms, 'admin');
                    if (ok) {
                        const totalSec = Math.round(ms / 1000);
                        sendOutput(`Restart scheduled in ${totalSec}s. Use "restart cancel" to abort.`, socketId, io);
                    }
                    else {
                        sendOutput('Cannot schedule: a restart is already firing.', socketId, io);
                    }
                }
            }
        }
    }
    else if (trimmedCommand === 'simtick' || trimmedCommand.startsWith('simtick ')) {
        // simtick <deltaSeconds> <durationSeconds> -> force every tick's deltaTime
        //   to <deltaSeconds> for <durationSeconds>, to reproduce a slow/GC-stalled
        //   tick on demand (this is what a mob-dense maze does for real) and watch
        //   whether anything else diverges the way the petal orbit spring did.
        // simtick status  -> show the active simulated spike, if any
        // simtick cancel  -> stop early
        const arg = trimmedCommand.slice('simtick'.length).trim();
        if (arg === 'status') {
            const info = (0, server_1.getSimulatedTickSpikeInfo)();
            if (!info)
                sendOutput('No simulated tick spike active.', socketId, io);
            else
                sendOutput(`Simulating dt=${info.deltaSeconds}s for ${(info.remainingMs / 1000).toFixed(1)}s more.`, socketId, io);
        }
        else if (arg === 'cancel' || arg === 'stop') {
            const wasActive = (0, server_1.cancelSimulatedTickSpike)();
            sendOutput(wasActive ? 'Simulated tick spike cancelled.' : 'No simulated tick spike to cancel.', socketId, io);
        }
        else if (arg === '') {
            sendOutput('Usage: simtick <deltaSeconds> <durationSeconds>|status|cancel', socketId, io);
            sendOutput('  Simulates a sustained slow tick (GC pause / overload) without an actual', socketId, io);
            sendOutput('  hang: the world (players, bots, petals, mobs, projectiles) only actually', socketId, io);
            sendOutput('  advances once per deltaSeconds of real time instead of every real tick,', socketId, io);
            sendOutput('  using deltaSeconds as its dt on that step — matching a genuinely slow', socketId, io);
            sendOutput('  tick (same real-world speed, fewer/bigger steps) rather than speeding', socketId, io);
            sendOutput('  everything up. Mobs (whose movement is not deltaTime-scaled) instead get', socketId, io);
            sendOutput('  their normal per-tick step replayed enough times on that step to cover', socketId, io);
            sendOutput('  the same ground, so they track everything else\'s speed too. Watch for', socketId, io);
            sendOutput('  other "large dt" divergence bugs while it runs.', socketId, io);
            sendOutput('  Examples:', socketId, io);
            sendOutput('    simtick 0.1 10   (hold dt at the server MAX_DELTA for 10s)', socketId, io);
            sendOutput('    simtick 0.3 5    (well past MAX_DELTA, for a harder stress test)', socketId, io);
        }
        else {
            const parts = arg.split(/\s+/);
            const deltaSeconds = parseFloat(parts[0]);
            const durationSeconds = parts.length >= 2 ? parseFloat(parts[1]) : 10;
            if (!Number.isFinite(deltaSeconds) || !Number.isFinite(durationSeconds)) {
                sendOutput('Usage: simtick <deltaSeconds> <durationSeconds>|status|cancel', socketId, io);
            }
            else {
                const result = (0, server_1.simulateTickSpike)(deltaSeconds, durationSeconds * 1000);
                sendOutput(result.message, socketId, io);
            }
        }
    }
}
// Generate a random code
function generateCode() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let code = '';
    for (let i = 0; i < 8; i++) {
        code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return code;
}
/**
 * Handle admin command from chat message
 * Returns true if the message was handled as an admin command, false otherwise
 */
function handleAdminCommand(message, socket, io, deps) {
    if (!socket.username)
        return false;
    // Check for admin commands (only admins can use /admin or /cmd). A player
    // holding a temporary grant (see tempAdmin.ts) counts as admin here — and
    // only here, plus the /help listing.
    if ((message.startsWith('/admin ') || message.startsWith('/cmd ')) && socket.username) {
        const isAdmin = database_1.database.isUserAdmin(socket.username) || (0, tempAdmin_1.hasTempAdmin)(socket.id);
        if (isAdmin) {
            // Extract the command after /admin or /cmd
            const command = message.substring(message.indexOf(' ') + 1);
            executeServerCommand(command, socket.username, deps, socket.id);
            return true; // Message was handled
        }
        else {
            // Not an admin - pretend command doesn't exist
            io.to(socket.id).emit('chatMessage', {
                sender: 'System',
                content: 'Command does not exist.',
                timestamp: Date.now()
            });
            return true; // Message was handled (even if rejected)
        }
    }
    return false; // Message was not an admin command
}
/**
 * Setup stdin command handler
 */
function setupStdinCommandHandler(deps) {
    process.stdin.on('data', (data) => {
        const command = data.toString().trim();
        executeServerCommand(command, undefined, deps);
    });
}
/**
 * Get help text for admin commands (for /help command)
 */
function getAdminHelpText() {
    return '<br/><br/>Admin commands:<br/>' +
        '/admin <command> - Execute server command<br/>' +
        '/cmd <command> - Execute server command (alternative)<br/>' +
        'Available server commands: save, list-players, list-sockets, set_max_enemies, set_bot_count <0-' + botManager_1.MAX_BOT_COUNT + '|default>, spawn_special_mobs, spawn <mobType> <rarity> [x] [y] [amount] [stack|unstack], killall (kill all wild mobs), teleport <playerId/username> <x> <y>, teleport_all <x> <y> (move every player, bots excluded), give <playerId/username> <itemType> <rarity> [amount], set_skin <playerId/username> <skin|none>, corrupt <playerId/username> [on|off|toggle] (corrupted flowers fight players anywhere, not just in PVP), grant_admin <playerId/username> (lend the admin console until they respawn), revoke_admin <playerId/username>, list_admins, mute <playerId/username> (bar an account from chat, persists across sessions), unmute <playerId/username>, notification <type> <message>, clear_notifications, delete_guests, list_today_logins, guild_list, guild_info <guild name>, guild_force_join <guild name> <username>, restart [<N>(s|m|h)|cancel|status], backup_db [list], update [now|<N>(s|m|h)|status|cancel] (backs up DB first, then installs latest build + restarts), change-maze [next|garden|desert|ocean|<dayNumber>], simtick <deltaSeconds> <durationSeconds>|status|cancel';
}
