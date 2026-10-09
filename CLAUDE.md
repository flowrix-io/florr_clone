# Project rules

## The TypeScript version is gone — recover it from git history

The TypeScript implementation was deleted on 2026-10-08: the browser client
(`src/`, `src/graphics/`, `src/title_screen/`, ...), the Node server
(`src/server/`, `src/ecs/`), the tsc/webpack toolchain, and the compiled
JavaScript that used to sit in `dist/`. `cpp/` is the only implementation:

- client — rendering, UI, menus, input, effects: `cpp/client/`
- server: `cpp/server/`
- shared code: `cpp/shared/`; tests: `cpp/tests/`; tools: `cpp/tools/`;
  the single-file offline build: `cpp/offline/`

Do not re-add TypeScript sources, tsconfig/webpack configs or compiled TS
output, and do not port a change "back" to TypeScript.

To see how the TypeScript version did something, read it out of history. The
last commit with the full TypeScript tree is **`d47055a7`**:

```sh
git ls-tree -r --name-only d47055a7 -- src/          # what existed
git show d47055a7:src/server/enemySpawner.ts         # read one file
git grep -n getEnemySizeScale d47055a7 -- src/       # search it
git log --oneline d47055a7 -- src/database.ts        # its history
```

Many comments in `cpp/` cite a TypeScript file as the reference a port was
taken from (`src/mobs.ts getEnemySizeScale`, `playerState.ts:2751`, "the
reference", "the browser build"). Those paths resolve in that history. A cited
line number is from whatever `src/` looked like when the comment was written:
`git blame` the C++ line, then `git show <that commit>:src/<file>`, or search
by symbol. "The browser build" in older comments usually means the TypeScript
version; in `cpp/client/web/`, the text and markup code and
`cpp/third_party/cpp_canvas/` it can mean the emscripten web client.

## Game data

- `data/mobs.json`, `data/petals.json`, `data/mob_drops.json` and `maps/`
  (Tiled maps — see `maps/README.md`) are the source of truth.
  `cpp/CMakeLists.txt` stages them flat into `<build>/data`, which the wasm
  builds embed as `/data`. The repo-root `data/` is not a valid `--data`
  directory by itself (it has no maps); run binaries from their build dir.
- The handshake compares a content hash taken over the raw bytes of the three
  JSON files, `maps.json`, every map it lists and their tilesets, so any edit
  to them — even reformatting — means client and server are rebuilt and
  shipped together.

## dist/

- `dist/` is committed: the in-game `/admin update` installs the `web`
  branch's zipball `dist/`, and prod runs `dist/server.js` + `dist/server.wasm`.
- What is committed there is exactly what `npm run build` stages
  (`scripts/build-web.js`): `index.html`, `bundle.js`, `bundle.js.bin`,
  `bundle.wasm`, `bundle.wasm.bin`, `server.js`, `server.wasm`,
  `favicon.ico`. `dist/inventory.json` (the live database) and the offline
  pages (`npm run build:offline`) are gitignored; never commit them.
- Rebuild it with `npm run build` from a clean tree and commit it with the
  source change. A `.bin` always moves together with its plain file.
- The C++ server takes no npm runtime dependency (the update never runs
  `npm install`); the only packages are the optional WebTransport pair.

## Protocol

Bump `kProtocolVersion` in `cpp/shared/net/protocol.h` whenever any message
layout changes, wherever it is written (`cpp/shared/net/`, `writeMapGrid`, the
skin format), and ship client and server together.

## Admin rights

Admin rights come only from server-held state: the account's `admin` flag in
the database, or a one-life `/admin grant_admin`. Never grant, check or target
a privilege by username, display name or any other string a player chooses.

## Reference clones

- `~/rysteria_gardn` — the visual/style reference (C++ client). Petal, mob and
  UI rendering should follow it.
- `~/gardn` — the movement/physics feel reference.

## Docs

`README.md` (build, run, test), `cpp/docs/ARCHITECTURE.md` (engine),
`maps/README.md` (map authoring), `cpp/docs/admin-dashboard.md` (admin tools),
`cpp/third_party/cpp_canvas/README.md` (the canvas library).
