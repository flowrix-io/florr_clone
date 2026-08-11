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
