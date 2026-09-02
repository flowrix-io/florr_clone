# Project rules

## The TypeScript client is frozen — do not update it

**As of 2026-09-01, `src/` (the TypeScript/webpack browser client) is no longer
maintained. Do not make changes to it.**

This applies to every agent, subagent and automated workflow working in this
repository, regardless of task type.

- Client work — rendering, UI, menus, input, effects — goes in `cpp/client/`
  only. The C++ client is the client now.
- Do not edit `src/graphics/`, `src/title_screen/`, or the other browser-client
  modules, and do not run `npm run build:client`, even when a change looks like
  it "should" be mirrored on both sides for parity.
- Ports that used to go JS → C++ now stop at C++. Treat the TypeScript client
  as a read-only reference: reading it to understand existing behaviour is
  fine and often useful, writing to it is not.
- If a task seems to require a TypeScript client change, say so and stop rather
  than making the edit.

The server (`src/server/`, `src/ecs/` and the shared game data such as
`src/petals.json` / `src/mobs.json`) is **not** covered by this freeze — those
are still live and are still the source of truth the C++ side is ported from.

## Reference clones

- `~/rysteria_gardn` — the visual/style reference (C++ client). Petal, mob and
  UI rendering should follow it.
- `~/gardn` — the movement/physics feel reference.
