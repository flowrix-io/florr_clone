"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.isUpdateInProgress = isUpdateInProgress;
exports.getLastUpdateStatus = getLastUpdateStatus;
exports.runAutoUpdate = runAutoUpdate;
const fs = __importStar(require("fs"));
const os = __importStar(require("os"));
const path = __importStar(require("path"));
const child_process_1 = require("child_process");
const database_1 = require("../database");
const server_1 = require("../server");
// Self-update pipeline for the `update` admin command:
//   1. Back up the database (MANDATORY — any failure aborts the update before
//      a single file is touched).
//   2. Download the repo's branch zipball from GitHub. dist/ is committed, so
//      the zipball carries the latest build; dist/inventory.json is gitignored,
//      so the archive can never contain a database.
//   3. Unzip into a staging dir in the OS temp dir and locate dist/ inside
//      (GitHub wraps everything in a "<repo>-<branch>/" top-level dir).
//   4. Overlay the new build onto the running dist dir. inventory.json (the
//      live database) is never overwritten; node_modules is left alone so the
//      Pi's source-built uWebSockets.js survives.
//   5. Schedule a restart — pm2/systemd boots the new build.
// Node happily keeps running with its files replaced underneath it (code was
// loaded at startup), so the overlay is safe to do on a live server.
const GITHUB_REPO = process.env.FLORR_UPDATE_REPO || 'flowrix-io/florr_clone';
const GITHUB_BRANCH = process.env.FLORR_UPDATE_BRANCH || 'typescript';
const DEFAULT_UPDATE_URL = process.env.FLORR_UPDATE_URL
    || `https://codeload.github.com/${GITHUB_REPO}/zip/refs/heads/${GITHUB_BRANCH}`;
// Top-level entries in the new build that must never overwrite live state.
const PRESERVED_TOP_LEVEL = new Set(['inventory.json', 'node_modules', 'db_backups', 'cert.key', 'cert.crt']);
// The dir the compiled server actually runs from (dist/ in a deployment):
// this file compiles to dist/server/autoUpdate.js, so one level up.
const runtimeDir = path.join(__dirname, '..');
let updateInProgress = false;
let lastUpdateStatus = 'No update has been run since this server started.';
function isUpdateInProgress() {
    return updateInProgress;
}
function getLastUpdateStatus() {
    return lastUpdateStatus;
}
async function runAutoUpdate(options) {
    const { report, restartDelayMs } = options;
    const url = options.url || DEFAULT_UPDATE_URL;
    if (updateInProgress) {
        report('[UPDATE] An update is already in progress.');
        return;
    }
    // Refuse to run outside a built deployment (e.g. ts-node-dev from src/):
    // overlaying compiled output onto the source tree would trash the repo.
    if (!fs.existsSync(path.join(runtimeDir, 'server.js'))) {
        throw new Error(`Refusing to update: ${runtimeDir} is not a built deployment (no server.js). Auto-update only runs on a dist build.`);
    }
    updateInProgress = true;
    lastUpdateStatus = 'Update in progress: backing up database...';
    let stagingDir = null;
    try {
        // ── 1. Database backup — must succeed before anything is modified ──
        report('[UPDATE] Step 1/4: backing up database (required before updating)...');
        let backup;
        try {
            backup = database_1.database.backupDatabase('pre-update');
        }
        catch (error) {
            const msg = error instanceof Error ? error.message : String(error);
            throw new Error(`Database backup FAILED — update aborted, nothing was changed. (${msg})`);
        }
        report(`[UPDATE] Database backed up to ${backup.file} (${(backup.bytes / 1024).toFixed(1)} KB)`);
        // ── 2. Download the new build ──
        lastUpdateStatus = 'Update in progress: downloading build...';
        report(`[UPDATE] Step 2/4: downloading ${url} ...`);
        stagingDir = fs.mkdtempSync(path.join(os.tmpdir(), 'florr-update-'));
        const zipPath = path.join(stagingDir, 'build.zip');
        const zipBytes = await downloadFile(url, zipPath);
        report(`[UPDATE] Downloaded ${(zipBytes / 1024 / 1024).toFixed(2)} MB`);
        // ── 3. Extract to staging ──
        lastUpdateStatus = 'Update in progress: extracting build...';
        report('[UPDATE] Step 3/4: extracting build...');
        const extractDir = path.join(stagingDir, 'extracted');
        fs.mkdirSync(extractDir);
        await unzipTo(zipPath, extractDir);
        const newBuildDir = findBuildDir(extractDir);
        if (!newBuildDir) {
            throw new Error('Downloaded archive does not contain a server build (no dist/server.js) — update aborted, running build untouched.');
        }
        // ── 4. Overlay onto the live dist ──
        lastUpdateStatus = 'Update in progress: installing files...';
        const copied = overlayCopy(newBuildDir, runtimeDir);
        report(`[UPDATE] Step 4/4: installed ${copied} files into ${runtimeDir} (inventory.json and node_modules preserved).`);
        // ── Restart so the new build takes over ──
        const scheduled = (0, server_1.scheduleRestart)(restartDelayMs, 'update');
        if (scheduled) {
            const totalSec = Math.round(restartDelayMs / 1000);
            lastUpdateStatus = `Update installed; restart scheduled ${totalSec}s after install. Backup: ${backup.file}`;
            report(`[UPDATE] Done. Server restarts in ${totalSec}s to load the new build ("restart cancel" or "update cancel" to abort the restart — the new files stay installed either way).`);
        }
        else {
            lastUpdateStatus = `Update installed; a restart was already firing, new build loads when the server comes back. Backup: ${backup.file}`;
            report('[UPDATE] Done. A restart is already firing — the new build loads when the server comes back up.');
        }
    }
    catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        lastUpdateStatus = `Last update FAILED: ${msg}`;
        throw error;
    }
    finally {
        updateInProgress = false;
        if (stagingDir) {
            try {
                fs.rmSync(stagingDir, { recursive: true, force: true });
            }
            catch { }
        }
    }
}
async function downloadFile(url, destPath) {
    const res = await fetch(url);
    if (!res.ok) {
        throw new Error(`Download failed: HTTP ${res.status} ${res.statusText}`);
    }
    const buf = Buffer.from(await res.arrayBuffer());
    // Zip local-file-header magic; catches S3 error XML saved as a "zip".
    if (buf.length < 4 || buf[0] !== 0x50 || buf[1] !== 0x4b) {
        throw new Error('Downloaded file is not a zip archive.');
    }
    fs.writeFileSync(destPath, buf);
    return buf.length;
}
// Locate the built server inside the extracted archive. Handles a GitHub
// branch zipball (<repo>-<branch>/dist/), a bare dist/ at the top level, and
// a flat archive of dist's contents.
function findBuildDir(extractDir) {
    const candidates = [path.join(extractDir, 'dist')];
    for (const entry of fs.readdirSync(extractDir, { withFileTypes: true })) {
        if (entry.isDirectory() && entry.name !== '__MACOSX') {
            candidates.push(path.join(extractDir, entry.name, 'dist'));
        }
    }
    candidates.push(extractDir);
    return candidates.find(c => fs.existsSync(path.join(c, 'server.js'))) || null;
}
function unzipTo(zipPath, destDir) {
    return new Promise((resolve, reject) => {
        (0, child_process_1.execFile)('unzip', ['-oq', zipPath, '-d', destDir], (err, _stdout, stderr) => {
            if (err)
                reject(new Error(`unzip failed: ${stderr?.trim() || err.message}`));
            else
                resolve();
        });
    });
}
// Recursively copy srcDir over dstDir, skipping preserved names at the top
// level only (inventory.json exists only at the dist root; deeper files with
// coincidental names are legitimate build output).
function overlayCopy(srcDir, dstDir, depth = 0) {
    let copied = 0;
    for (const entry of fs.readdirSync(srcDir, { withFileTypes: true })) {
        if (depth === 0 && PRESERVED_TOP_LEVEL.has(entry.name))
            continue;
        const from = path.join(srcDir, entry.name);
        const to = path.join(dstDir, entry.name);
        if (entry.isDirectory()) {
            fs.mkdirSync(to, { recursive: true });
            copied += overlayCopy(from, to, depth + 1);
        }
        else if (entry.isFile()) {
            fs.copyFileSync(from, to);
            copied++;
        }
    }
    return copied;
}
