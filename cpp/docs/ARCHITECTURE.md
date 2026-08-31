# florr C++ — architecture

A clean-sheet C++ rewrite. The TypeScript tree in `src/` is a **behavioural
reference only**: it says what the game feels like and what its data files
mean. None of its structure, workarounds or defects carry across.

What is deliberately kept:

* **Gameplay style** — a flower with an orbiting ring of petals, attack/defend,
  tiered mobs, loot that drops and is absorbed into an inventory, crafting up
  the rarity ladder.
* **UI style** — the flat, rounded, high-contrast look: thick dark outlines,
  rarity-coloured panels, chunky text with a stroked outline.
* **`src/mobs.json` and `src/petals.json`** — loaded verbatim, including the
  inline SVG artwork.
* **`inventory.json`** — the account database, read and written in the same
  JSON shape.

What is deliberately *not* kept: the wire protocol, the entity model, the
rendering stack, the DOM. **There is no HTML and no CSS anywhere in this
project.** The client is a native SDL2 application and every pixel of it —
title screen, login form, HUD, inventory, chat — is drawn through the
`cpp_canvas` 2D API.

---

## Layout

```
cpp/
  shared/         code both binaries link
    core/         entity.h component.h world.{h,cpp} types.h json.{h,cpp}
    net/          bytebuffer.h protocol.h transport.{h,cpp}
    game/         constants.h rarity.{h,cpp} components.h config.{h,cpp}
  server/         headless authoritative simulation
  client/         SDL2 window, rendering, UI, prediction
  third_party/
    cpp_canvas/   the vendored Canvas2D-alike renderer
  data/           runtime copies of mobs.json / petals.json / mob_xp.json
  tests/          one binary, all tests
```

Includes are always repo-relative from `cpp/`: `#include "shared/core/world.h"`.

---

## The ECS

`shared/core/world.h`. Archetype storage: entities with the same component set
share contiguous per-component columns.

```cpp
World world;
Entity e = world.create();
world.add<Transform>(e, Transform{{100, 200}, 0.0});
world.add<Health>(e, Health{50, 100});

Query<Transform, Motion> movers{world};      // build ONCE, reuse every tick
movers.each([&](Entity e, Transform& t, Motion& m) {
    t.position += m.velocity * dt;
});
```

Rules that matter:

* **Build queries once**, as a member of the system. Constructing one per tick
  throws away the archetype cache that makes iteration free.
* **Never create or destroy an entity inside `each`.** Column pointers are live
  during iteration. Record the intent in a `CommandBuffer` and let the runtime
  flush it between phases.
* **Frequently-toggled state is a field, not a tag.** Adding or removing a
  component relocates the entity and copies all of its data. `Dead` is a tag
  because an entity dies once; "is currently poisoned" is a field on
  `Afflictions` because it changes constantly.
* Component structs live in `shared/game/components.h` and are registered with
  `FLR_COMPONENT(...)` at global scope. Add new ones there, not locally.

## Simulation

Fixed **25 Hz** (`net::kTicksPerSecond`). The server never varies its step.

Phase order, once per tick — later phases may rely on earlier ones having run:

1. **Input** — drain client input into `PlayerInput`.
2. **Intent** — AI decides targets and headings; player input becomes a desired
   velocity.
3. **Movement** — integrate velocity under friction, resolve tiles, apply and
   decay knockback.
4. **Rings** — petals are placed on their owner's ring.
5. **Combat** — contact damage, petal hits, projectiles, afflictions.
6. **Lifecycle** — deaths, XP and loot awards, drops, despawns, spawning.
7. **Replication** — build and send each client's snapshot.
8. **Flush** — apply the tick's `CommandBuffer`.

Deaths mark `Dead` rather than destroying, so everything later in the same tick
still sees the entity. The reaper destroys them in phase 8.

## Networking

`shared/net/`. TCP, `[u32 length][u8 type][payload]`, little-endian, no type
tags inside a payload. `protocol.h` is the single source of truth for message
ids and field order; both sides read it.

* `Listener` (server) and `Dialer` (client) both drive a `poll()` loop and hand
  whole frames to a `TransportHandler`.
* A malformed length prefix drops the connection; a truncated frame yields a
  zeroed message the handler discards. Neither can corrupt state.
* Snapshots are per-client and viewport-scoped. An entity entering view is sent
  once as a spawn record (kind, type, rarity, name); afterwards only the fields
  in its `UpdateFields` mask.
* `NetId` is a never-reused u32, distinct from `Entity`, so a client that missed
  a removal cannot apply an update to the wrong thing.

## Client prediction

The client runs `integrateVelocity` from `shared/game/constants.h` — literally
the same function the server runs. It keeps unacknowledged inputs in a ring,
and on each snapshot snaps to the authoritative position and replays the inputs
the server has not yet acknowledged. In open movement the two agree exactly and
nothing visibly corrects. Remote entities are interpolated one snapshot behind.

## Rendering

`third_party/cpp_canvas`, a Canvas2D-shaped API (`save`/`restore`,
`translate`/`rotate`/`scale`, paths, `fill`/`stroke`, `fillText`,
`drawCanvas`). `SvgDocument::fromString()` compiles the SVG strings in
`mobs.json` / `petals.json` into canvas calls — that is how mob and petal
artwork survives the rewrite intact.

Draw order per frame: terrain → ground effects → drops → mobs → petals →
players → floating damage → HUD → panels → cursor.

## Style

Match the surrounding code:

* C++17. `snake_case` files, `PascalCase` types, `camelCase` functions and
  variables, `kCamelCase` constants.
* Comment *why*, not *what*. A comment earns its place by explaining a
  non-obvious decision, an invariant, or a trap. No banner comments restating
  a function's name.
* No exceptions in the tick path. Bad input is clamped or dropped, never thrown.
* Tests go in `cpp/tests/`, use `tests/test.h` (`TEST`, `CHECK`, `CHECK_EQ`,
  `CHECK_NEAR`), and must cover the edge cases — not just the happy path.
* Never introduce HTML, CSS, or a DOM dependency.
