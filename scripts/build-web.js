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
 *   offline.html  the offline build: server AND client in one wasm, embedded
 *                 in one page with nothing beside it. Opens from disk.
 *   offline-asmjs.html
 *                 the same page for a browser with no wasm engine: the module
 *                 is translated to JavaScript (-sWASM=0). Bigger and slower;
 *                 built only when asked for, because the translation takes
 *                 minutes.
 *
 * bundle.html becomes dist/index.html because that is the name a web root is
 * served at. styles.css and favicon.ico are copied too: the shell references
 * both, and neither is inside the wasm.
 *
 * The two files the page downloads are also staged deflated, as bundle.js.bin
 * and bundle.wasm.bin -- see compress() below. This is what the TypeScript
 * build did with scripts/compressbundle.js, extended to the wasm, which is
 * where the bytes are now.
 *
 * Usage:
 *   node scripts/build-web.js [client|server|offline|offline-asmjs|all] [--copy-only]
 *
 *   `all` is the deployment: client and server. Either offline page is asked
 *   for by name -- neither is something `npm start` serves, and both are
 *   gitignored in dist/ so a rebuilt multi-megabyte page does not land in
 *   every commit of the (otherwise committed) dist/.
 *
 *   --copy-only   skip cmake and stage whatever is already in cpp/build-web.
 *                 For machines without emscripten; it will happily copy a
 *                 stale build, so it is not what a release goes through.
 *
 * Env:
 *   FLIX_BUILD    dev | release (default release -- this is the shipping build)
 *
 * `npm run build` and `npm start` both pin FLIX_BUILD=release, so what they
 * produce does not depend on what happens to be in the environment; `npm run
 * build:dev` is the dev-flavoured equivalent. Switching flavour wipes
 * cpp/build-web first -- see reconfigure() for why that has to happen.
 *
 * Note that dist/server.js has two possible producers: this script, and
 * `npm run build:server:ts`, which is the frozen-era TypeScript server and
 * writes the same path. Whichever ran last is what `npm start` runs.
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
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
        // Staged deflated beside themselves, as <name>.bin. These are the
        // two files the page pulls over the network; index.html is served
        // uncompressed because nothing can inflate it before it has loaded.
        compressed: ['bundle.js', 'bundle.wasm'],
    },
    server: {
        cmakeTarget: 'flowrix_server',
        artifacts: [
            ['server.js', 'server.js'],
            ['server.wasm', 'server.wasm'],
        ],
        sidecars: [],
    },
    // Not part of `all`: see the header. One file, nothing referenced.
    offline: {
        cmakeTarget: 'flowrix_offline',
        artifacts: [
            ['offline.html', 'offline.html'],
        ],
        sidecars: [],
    },
    // The same page with the module translated to JavaScript, for a browser
    // that cannot run wasm at all. Excluded from cmake's `all` as well as this
    // script's, because wasm2js re-codegens the whole module and takes minutes.
    'offline-asmjs': {
        cmakeTarget: 'flowrix_offline_asmjs',
        artifacts: [
            ['offline-asmjs.html', 'offline-asmjs.html'],
        ],
        sidecars: [],
    },
};
const DEPLOYMENT = ['client', 'server'];

function fail(message) {
    console.error(`\nbuild-web: ${message}\n`);
    process.exit(1);
}

const args = process.argv.slice(2);
const copyOnly = args.includes('--copy-only');
const which = args.find((a) => !a.startsWith('-')) || 'all';
if (which !== 'all' && !TARGETS[which]) {
    fail(
        `unknown target '${which}' — expected client, server, offline, ` +
        `offline-asmjs or all`
    );
}
const selected = which === 'all' ? DEPLOYMENT : [which];

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

/** The FLIX_BUILD the existing cpp/build-web was configured with, or null. */
function configuredFlavour() {
    const cache = path.join(BUILD_DIR, 'CMakeCache.txt');
    if (!fs.existsSync(cache)) return null;
    const m = /^FLIX_BUILD:STRING=(\w+)$/m.exec(fs.readFileSync(cache, 'utf8'));
    return m ? m[1] : null;
}

if (!copyOnly) {
    // A flavour switch is a full rebuild, not a reconfigure. cmake's Makefile
    // generator does not make an object depend on the flags it was compiled
    // with, so re-running cmake with a different FLIX_BUILD updates the flags
    // and then relinks the *old* objects: a release build carrying dev code,
    // with nothing in the output to say so. Ninja would notice; the generator
    // here does not, so drop the tree instead of trusting it.
    const previous = configuredFlavour();
    if (previous && previous !== flavour) {
        console.log(
            `build-web: cpp/build-web holds a ${previous} build and this is a ` +
            `${flavour} one -- removing it so nothing is reused across the switch.`
        );
        fs.rmSync(BUILD_DIR, { recursive: true, force: true });
    }

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

/**
 * Writes dist/<name>.bin: the staged dist/<name>, raw-deflated.
 *
 * The page prefers these over the files they were made from and inflates them
 * with DecompressionStream -- see the loader in cpp/client/web/shell.html.
 * Raw deflate, not gzip, because 'deflate-raw' is what that API takes and the
 * headers buy nothing here; this is the codec scripts/compressbundle.js used
 * for the TypeScript client's bundle, and the page's half of it is that page's
 * loader carried over.
 *
 * Done at staging rather than at the link, which is deliberate: a dev relink
 * should not spend a second deflating four megabytes, and a build served
 * straight out of cpp/build-web has no .bin beside it. The loader falls back
 * to the uncompressed file, which is always staged too.
 *
 * Both copies of one artifact must move together. A dist/ holding a .bin from
 * an older build than the file beside it is a client that loads the old wasm
 * while everything else is new -- so a hand-carried deploy copies the pair,
 * not just the file it noticed changing.
 */
function compress(name) {
    const source = path.join(DIST, name);
    const packed = zlib.deflateRawSync(fs.readFileSync(source), {
        level: zlib.constants.Z_BEST_COMPRESSION,
    });
    fs.writeFileSync(path.join(DIST, `${name}.bin`), packed);
    const ratio = (100 * packed.length) / Math.max(1, fs.statSync(source).size);
    return [`${name}.bin`, packed.length, `${ratio.toFixed(0)}% of ${name}`];
}

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
    for (const to of TARGETS[name].compressed || []) copied.push(compress(to));
}

// --copy-only builds nothing, so FLIX_BUILD says nothing about what was just
// staged -- the cache of the tree it was copied from is the only witness.
const staged = copyOnly ? (configuredFlavour() || 'unknown-flavour') : flavour;
console.log(`\nStaged the ${staged} web build (${selected.join(', ')}) in dist/:`);
for (const [name, size, note] of copied) {
    const line = `  ${name.padEnd(16)} ${(size / 1024).toFixed(1).padStart(9)} KiB`;
    console.log(note ? `${line}   ${note}` : line);
}
