#!/usr/bin/env node
/**
 * Build and run the broad-phase grid benchmark.
 *
 *   npm run bench:grid
 *
 * Compiles the whole server tree to dist_bench/ (a throwaway outDir, so the
 * committed dist/ the autoupdater serves is never touched) and runs the
 * comparison with --expose-gc so the heap-growth numbers mean something.
 *
 * Re-execs itself under --expose-gc when not already running with it.
 */

const { execFileSync, spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const root = path.resolve(__dirname, '..');
const outDir = path.join(root, 'dist_bench');

if (typeof globalThis.gc !== 'function') {
    const result = spawnSync(process.execPath, ['--expose-gc', __filename], { stdio: 'inherit' });
    process.exit(result.status === null ? 1 : result.status);
}

process.stdout.write('Compiling server tree for benchmark ... ');
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

const entry = path.join(outDir, 'ecs', 'bench', 'grid_bench.js');
if (!fs.existsSync(entry)) {
    console.error(`Compiled benchmark missing at ${entry}`);
    process.exit(1);
}

require(entry).runGridBench();
