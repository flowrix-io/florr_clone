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
