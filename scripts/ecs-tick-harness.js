#!/usr/bin/env node
/**
 * Build and run the headless ECS tick harness.
 *
 *   npm run harness:ecs
 *
 * Compiles the server tree to dist_bench/ (never the committed dist/) and runs
 * the full scheduler over a populated world, asserting the simulation stays
 * finite and inside the 30Hz tick budget.
 */
const { execFileSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const root = path.resolve(__dirname, '..');
const outDir = path.join(root, 'dist_bench');

process.stdout.write('Compiling server tree ... ');
try {
    execFileSync(
        process.execPath,
        [path.join(root, 'node_modules', 'typescript', 'bin', 'tsc'), '-p', 'tsconfig.bench.json'],
        { cwd: root, stdio: 'pipe' },
    );
} catch (err) {
    process.stdout.write('FAILED\n\n');
    process.stdout.write(String(err.stdout || '') + String(err.stderr || ''));
    process.exit(1);
}
process.stdout.write('ok\n\n');

const entry = path.join(outDir, 'ecs', 'bench', 'tick_harness.js');
if (!fs.existsSync(entry)) {
    console.error(`Compiled harness missing at ${entry}`);
    process.exit(1);
}
require(entry).main();

// The player-movement cutover check runs here rather than in test:ecs because it
// needs the SERVER tree (server/ecsSync, constants) compiled, which is what this
// script already builds. It drives the real sync window against a verbatim copy
// of the legacy movement code — see the file header for why the other three
// gates cannot catch what it catches.
const cutover = path.join(outDir, 'ecs', 'bench', 'player_cutover_check.js');
if (!fs.existsSync(cutover)) {
    console.error(`Compiled cutover check missing at ${cutover}`);
    process.exit(1);
}
console.log('');
require(cutover).main();

// The other half of the same boundary: writes aimed at ANOTHER player made from
// inside a player's updatePlayerState (PVP knockback, the yggdrasil revive).
// Those land in the gap between the movement window and that player's own
// commit, so whether they survive depends on iteration order — see the file
// header. Same reason as above for living here: it needs the server tree.
const writeback = path.join(outDir, 'ecs', 'bench', 'player_writeback_check.js');
if (!fs.existsSync(writeback)) {
    console.error(`Compiled write-back check missing at ${writeback}`);
    process.exit(1);
}
console.log('');
require(writeback).main();

// The petal-ring cutover oracle. Same reason as the two above for living here
// rather than in test:ecs — it drives server/ecsSync's real `openPetalRing`, so
// it needs the SERVER tree compiled. It compares the ECS ring against a verbatim
// copy of the legacy petal kinematics, bit for bit; see the file header for the
// three failure modes the other gates structurally cannot see.
const petals = path.join(outDir, 'ecs', 'bench', 'petal_cutover_check.js');
if (!fs.existsSync(petals)) {
    console.error(`Compiled petal cutover check missing at ${petals}`);
    process.exit(1);
}
console.log('');
require(petals).main();

// The bot cutover oracle. It lives here for a stronger reason than the three
// above: as well as needing the server tree, it is the only gate that REQUIRES
// server/botManager.ts at all. Loading it is itself the first assertion — that
// module used to drag petal_actions.ts and server/playerState.ts in at module
// scope, either of which binds port 3000 and opens the account database, so no
// gate could touch bot code without starting a second live game server. Keep
// this last: it drives a full bot tick (targeting, squads, chat emits, the
// oscillation watchdog) and then re-asserts that nothing booted.
const bots = path.join(outDir, 'ecs', 'bench', 'bot_cutover_check.js');
if (!fs.existsSync(bots)) {
    console.error(`Compiled bot cutover check missing at ${bots}`);
    process.exit(1);
}
console.log('');
require(bots).main();
