# flowrix ![florr](src/splitter_small.svg)

[florr.io](https://florr.io) clone

[Public Server](https://florrclone.cryodome.com)

[Discord](https://discord.com/invite/SvAYCGsmAg)

> **License notice:** As of October 2026 this project is licensed under the
> [GNU Affero General Public License v3.0 or later](LICENSE) (previously GPL v3
> or later, and before that ISC), because it contains code adapted from
> [gardn](https://github.com/trigonal-bacon/gardn), which is AGPL-licensed.
> If you distribute this software or a modified version of it, or run a
> modified version as a network service, you must do so under the same license
> and make the corresponding source code available to its users.

![Title Screen](img/title_screen.png)

## Quick start

Requires Node.js 22+, Emscripten, Make and CMake

```bash
npm install
npm run build   # builds cpp, webpacks the client, compresses bundle
npm start       # compiles the server and runs dist/server.js
```

Open `https://localhost:3000`.

### Play offline

```bash
npm run build:offline   # -> dist/offline.html (needs emscripten on PATH)
```

`dist/offline.html` is the whole game in one file: the server and the client
compiled into one wasm and embedded in the page. Open it straight from disk —
no server, no network. Your account and progress are kept in that browser's
local storage. See `cpp/docs/ARCHITECTURE.md`, "The offline build".

For a browser that cannot run WebAssembly at all:

```bash
npm run build:offline:asmjs   # -> dist/offline-asmjs.html
```

The same page with the module translated to JavaScript. It is bigger (~8.5MB)
and slower, and the build takes several minutes, so it is built only when
asked for.

## If the game is blocked at your school, try using [https://florrclone.cryodome.com:3000](https://florrclone.cryodome.com:3000), click advanced options and continue to site.

## Scripts

| Script | Purpose |
| --- | --- |
| `npm run build` | Build cpp module, bundle client (production), compress bundle |
| `npm run build:offline` | Single-file offline build: server and client in one page, `dist/offline.html`, opens from disk with no server |
| `npm run build:offline:asmjs` | The same page without WebAssembly (wasm2js), `dist/offline-asmjs.html` — bigger, slower, several minutes to build |
| `npm run build:server` | TypeScript compile of the server only |
| `npm run build:client` | TypeScript compile of the client only |
| `npm start` | Build server and run `dist/server.js` |
| `npm run dev` | Webpack dev watch |
| `npm run dev:server` | Run server under `ts-node-dev` |
| `npm run svg2skin -- art.svg` | Convert an SVG into custom-skin commands |

## Like the game? Star the github repository!

## License

Copyright (c) 2026 sussybite8888

This program is free software: you can redistribute it and/or modify it under
the terms of the GNU Affero General Public License as published by the Free
Software Foundation, either version 3 of the License, or (at your option) any
later version. See [LICENSE](LICENSE) for the full text.

This program is distributed in the hope that it will be useful, but WITHOUT
ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS
FOR A PARTICULAR PURPOSE. See the GNU Affero General Public License for more
details.

Parts of the C++ client -- the mob, petal and flower artwork among them -- are
adapted from [gardn](https://github.com/maxnest0x0/gardn), licensed under the
GNU Affero General Public License v3.0.

Versions of this project before October 2026 were distributed under the GNU
General Public License v3.0 or later, and earlier versions under the ISC
License.
