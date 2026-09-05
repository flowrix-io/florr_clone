#!/usr/bin/env node
/**
 * Builds the C++ (emscripten) client and server and stages them in dist/.
 *
 * Both halves of the game are C++ now, and both run in a JavaScript runtime on
 * the web: the client in the page, the server under Node. `npm run build` and
 * `npm start` go through this script instead of webpack and tsc.
 *
 * The emscripten link emits, under the names CMakeLists.txt gives the web
 * build (the TypeScript build's names, so that nginx, pm2 and the autoupdate
 * zipball keep working unchanged):
 *
 *   bundle.html   the page (cpp/client/web/shell.html, minified) -> index.html
 *   bundle.js     the client's runtime glue
 *   bundle.wasm   the client, with mobs.json / petals.json / the map bundle /
 *                 the biome SVGs / the fonts embedded inside it
 *   server.js     the server's runtime glue -- what `node dist/server.js` runs
 *   server.wasm   the server, with the same content embedded
 *
 * bundle.html becomes dist/index.html because that is the name a web root is
 * served at. styles.css and favicon.ico are copied too: the shell references
 * both, and neither is inside the wasm.
 *
 * Usage:
 *   node scripts/build-web.js [client|server|all] [--copy-only]
 *
 *   --copy-only   skip cmake and stage whatever is already in cpp/build-web.
 *                 For machines without emscripten; it will happily copy a
 *                 stale build, so it is not what a release goes through.
 *
 * Env:
 *   FLIX_BUILD    dev | release (default release -- this is the shipping build)
 *
 * Note that dist/server.js has two possible producers: this script, and
 * `npm run build:server:ts`, which is the frozen-era TypeScript server and
 * writes the same path. Whichever ran last is what `npm start` runs.
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const os = require('os');

const ROOT = path.resolve(__dirname, '..');
const CPP_DIR = path.join(ROOT, 'cpp');
const BUILD_DIR = path.join(CPP_DIR, 'build-web');
const DIST = path.join(ROOT, 'dist');

// cmake target -> the files it emits, as [name in cpp/build-web, name in dist].
const TARGETS = {
    client: {
        cmakeTarget: 'flowrix_client',
        artifacts: [
            ['bundle.html', 'index.html'],
            ['bundle.js', 'bundle.js'],
            ['bundle.wasm', 'bundle.wasm'],
        ],
        // Referenced by the shell, not part of the link.
        sidecars: [
            [path.join(ROOT, 'src', 'styles.css'), 'styles.css'],
            [path.join(ROOT, 'src', 'favicon.ico'), 'favicon.ico'],
        ],
    },
    server: {
        cmakeTarget: 'flowrix_server',
        artifacts: [
            ['server.js', 'server.js'],
            ['server.wasm', 'server.wasm'],
        ],
        sidecars: [],
    },
};

function fail(message) {
    console.error(`\nbuild-web: ${message}\n`);
    process.exit(1);
}

const args = process.argv.slice(2);
const copyOnly = args.includes('--copy-only');
const which = args.find((a) => !a.startsWith('-')) || 'all';
if (which !== 'all' && !TARGETS[which]) {
    fail(`unknown target '${which}' — expected client, server or all`);
}
const selected = which === 'all' ? Object.keys(TARGETS) : [which];

const flavour = process.env.FLIX_BUILD || 'release';
if (flavour !== 'dev' && flavour !== 'release') {
    fail(`FLIX_BUILD must be dev or release, not '${flavour}'`);
}

/** Run a command with the repo root as cwd, inheriting stdio. Exits on failure. */
function run(cmd, argv) {
    console.log(`$ ${cmd} ${argv.join(' ')}`);
    const res = spawnSync(cmd, argv, { cwd: ROOT, stdio: 'inherit' });
    if (res.error && res.error.code === 'ENOENT') {
        fail(
            `'${cmd}' is not on PATH.\n` +
            `The web build is an emscripten build: install the emsdk (or ` +
            `\`brew install emscripten\`) and make sure emcmake/emcc are on ` +
            `PATH, or re-run with --copy-only to stage the existing build in ` +
            `cpp/build-web.`
        );
    }
    if (res.status !== 0) fail(`${cmd} exited with status ${res.status}`);
}

if (!copyOnly) {
    // Configure every time rather than only when the cache is missing: cmake
    // re-runs cheaply, and it is what notices an edited CMakeLists.txt or a
    // flavour switch. emcmake is what puts the emscripten toolchain file on
    // the command line.
    run('emcmake', ['cmake', '-S', CPP_DIR, '-B', BUILD_DIR, `-DFLIX_BUILD=${flavour}`]);
    const jobs = String(os.cpus().length);
    for (const name of selected) {
        run('cmake', ['--build', BUILD_DIR, '--target', TARGETS[name].cmakeTarget, '-j', jobs]);
    }
}

// --- stage into dist ---------------------------------------------------------
fs.mkdirSync(DIST, { recursive: true });

const copied = [];
for (const name of selected) {
    for (const [from, to] of TARGETS[name].artifacts) {
        const src = path.join(BUILD_DIR, from);
        if (!fs.existsSync(src)) {
            fail(
                `${path.relative(ROOT, src)} does not exist.` +
                (copyOnly ? ' Drop --copy-only to build it.' : ' The build did not emit it.')
            );
        }
        const dest = path.join(DIST, to);
        fs.copyFileSync(src, dest);
        copied.push([to, fs.statSync(dest).size]);
    }
    for (const [src, to] of TARGETS[name].sidecars) {
        if (!fs.existsSync(src)) continue;
        const dest = path.join(DIST, to);
        fs.copyFileSync(src, dest);
        copied.push([to, fs.statSync(dest).size]);
    }
}

console.log(`\nStaged the ${flavour} web build (${selected.join(', ')}) in dist/:`);
for (const [name, size] of copied) {
    console.log(`  ${name.padEnd(16)} ${(size / 1024).toFixed(1).padStart(9)} KiB`);
}
