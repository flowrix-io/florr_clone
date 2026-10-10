# flowrix — architecture

The game is C++: one authoritative server and one client, from one source tree
under `cpp/`, each built natively and, with emscripten, for a JavaScript
runtime. The web build is what the public server runs — the client as a page,
the server under Node. [README.md](../../README.md) has the commands to build,
run and test any of it; this file is how the engine fits together, and why.

It began as a clean-sheet rewrite of a TypeScript version, which served as the
**behavioural reference**: it said what the game feels like and what its data
files mean. None of its structure, workarounds or defects carried across. That
version was deleted on 2026-10-08 and lives on in git history — the last commit
with the whole tree is `d47055a7` (`git show d47055a7:src/<path>`). Comments
here that cite a `src/` file or "the reference" point into it;
[CLAUDE.md](../../CLAUDE.md) says how to follow them.

What was deliberately kept:

* **Gameplay style** — a flower with an orbiting ring of petals, attack/defend,
  tiered mobs, loot that drops and is absorbed into an inventory, crafting up
  the rarity ladder.
* **UI style** — the flat, rounded, high-contrast look: thick dark outlines,
  rarity-coloured panels, chunky text with a stroked outline.
* **The data files' shape** — `data/mobs.json`, `data/petals.json` and
  `data/mob_drops.json` are the JSON the TypeScript version read, grown since
  the rewrite began rather than redesigned. The artwork lives in them too: an
  inline SVG for nearly every petal and a few mobs, the name of a painter for
  most mobs (see Rendering).
* **`inventory.json`** — the account database, read and written in the JSON
  shape the TypeScript server wrote, because live accounts exist in that shape.
  Keys this build does not model are kept and written back untouched
  (`server/db.h`).

What was deliberately *not* kept: the wire protocol, the entity model, the
rendering stack, the DOM UI. **There is no DOM UI.** Every pixel — title
screen, login form, HUD, inventory, chat — is drawn through the `cpp_canvas` 2D
API: into an SDL2 window natively, onto the page's one `<canvas>` in a browser.
The only HTML and CSS are the two shell pages that host that canvas
(`client/web/shell.html`, `offline/shell.html`). Everything else a browser has
to be asked for is a small `EM_JS` function beside the C++ that needs it: the
canvas, input and the hidden text input (Touch) in `cpp_canvas`, text
measurement in `client/ui/`, browser storage and the stale-build reload in
`client/web/`, and the transports in `shared/net/web_channel.cpp`, among
others.

---

## Layout

```
cpp/            the game (below)
data/           mobs.json, petals.json, mob_drops.json -- the content
maps/           the Tiled world maps, their tileset and art (maps/README.md)
dist/           the committed web build: what deploys (dist/ and shipping)
scripts/        the Node scripts behind the npm scripts: build-web.js,
                gen-dev-cert.js, ws-conformance.js, svg-to-skin.js; and
                ctx_capture.js, a canvas recorder pasted into a page's console
tools/          arduino-cpu-matrix -- the test board's CPU-load display
maps_old/       an archive of the retired map format; nothing reads it
```

```
cpp/
  CMakeLists.txt  the one build definition, native and emscripten
  shared/         code both programs link
    core/         world.{h,cpp} entity.h component.h -- the ECS;
                  json.{h,cpp} types.h process_stats.{h,cpp};
                  text.h file.h -- the string and file helpers everything shares
    net/          protocol.h -- every message; bytebuffer.h;
                  transport.{h,cpp} -- framing, Listener, Dialer;
                  web_channel.{h,cpp} -- WebSocket/WebTransport/loopback,
                  emscripten; admin_db, admin_dashboard -- the admin tools'
                  messages
    game/         components.h; config.{h,cpp} -- the content registry and
                  its hash; constants.h rarity realm.h npc.h difficulty.h;
                  tiled_map terrain map_elements -- the .tmj reader, the
                  collision it builds out of each tile's authored shapes,
                  the annotations; spatial -- the broadphase; chat_images ...
  server/         headless authoritative simulation: game_server (the tick),
                  session, replication, db, chat_commands, bot_ai,
                  auto_update, squads, splitter
    systems/      movement petals mob_ai combat spawning mode_spawning
                  dungeons npcs loot
  client/         app*.cpp (screens, HUD, chat, minimap), net_client,
                  world_view (the snapshot mirror and its motion),
                  interpolation.h ease.h camera.h
    render/       world_renderer, sprites, mob_art (painted mobs),
                  skin_render, art_cache
    ui/           menus and panels, text, markup (chat lines),
                  mobile_controls (the touch stick and its two buttons),
                  menu_assets asset_files (the asset browser)
    web/          shell.html (the page), persist (browser storage),
                  reload (stale builds), boot (boot scripts), favicon.ico
      boot/       the debug tools a page load can run instead of the game
  offline/        main.cpp shell.html -- server and client in one page
  tests/          one binary, all tests
  tools/          native diagnostic programs (Tests and tools)
  cmake/          prune_staged_content.cmake; font_metrics.js (the web
                  builds' outline-free copy of the font)
  docs/           this file, admin-dashboard.md
  third_party/
    cpp_canvas/   the vendored Canvas2D-alike renderer, locally modified
```

Includes are repo-relative from `cpp/` — `#include "shared/core/world.h"` —
except the vendored canvas headers, which are included by bare name
(`"canvas.h"`). Build directories (`cpp/build`, `cpp/build-web`, ...) are
gitignored.

**The staged content directory.** The server and the client never read `data/`
or `maps/` where they sit. `cpp/CMakeLists.txt` stages them flat, by bare file
name, into `<build>/data` — the three JSON files, `maps/maps.json` and every
map it lists, the tilesets those maps name, the tile art, the title screen's
ground art, and the Ubuntu Bold the configure downloads, plus on the web
`Ubuntu-Bold.metrics` (below) — and prunes the directory to exactly that set
first (`cmake/prune_staged_content.cmake`), so a file that stopped being
content is not shipped inside the next wasm. Flat is what makes the references
inside the files resolve: a map names its tilesets as siblings, and the client
looks a tile's art up by bare name. The wasm builds embed the directory as
`/data`, minus what each has no use for: the client leaves out the TTF, the
server leaves out the TTF and its metrics, and only the offline page carries
both. Both programs take `--data <dir>`, default `data`, so a native binary is
run from its build directory; the repository's own `data/` has no maps and is
not a valid `--data` directory.

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
  during iteration. Record the intent in a `CommandBuffer` and let the tick
  flush it, once every system has run (the reap phase, below).
* **Frequently-toggled state is a field, not a tag.** Adding or removing a
  component relocates the entity and copies all of its data. `Dead` is a tag
  because it is set about once in an entity's life; "is currently poisoned" is
  a field on `Afflictions` because it changes constantly.
* Component structs are registered with `FLIX_COMPONENT(...)` at global scope.
  Almost all of them live in `shared/game/components.h`; the few that only the
  server's systems use are declared beside the system that owns them —
  `PetalSlotState` in `server/systems/petals.h`, `LootAwarded` in `loot.h`,
  `AmbientMob` and `NestWaves` in `spawning.h`.
  Anything the client or another layer needs goes in `components.h`.

## Simulation

`net::kTicksPerSecond`: 30 Hz (`shared/net/protocol.h`). The rate is fixed —
contact opportunities, the fixed-step mob AI and every one-tick transition
depend on it — but not every system integrates the same step
(`GameServer::runSystems`):

* **The mob half is fixed-step.** Mob AI, mob and projectile flight and
  spawning are handed `net::kTickSeconds` explicitly, as the TypeScript server
  handed its `moveEnemies` a hard 1/30.
* **The flower half is dt-scaled.** Player movement, petals, combat and loot
  get the smoothed real step: the time since the last tick, clamped to three
  nominal ticks so a stall cannot be paid back as one giant step through a
  wall, then low-pass filtered so tick jitter never reaches the integration.
* **Deadlines run on the real clock.** Poison, slows, reloads, hit cooldowns
  and despawns are compared against when the tick actually ran, not its
  scheduled slot, which would make them all fire late and then jump.
* **A late tick is never replayed.** An overrun makes the next tick come at
  once; it does not run twice to catch up, because a replay would advance the
  fixed-step half once per replay while the dt-scaled half, its delta just
  reset, stood still.

Phase order, once per tick (`GameServer::tick`, `server/game_server.cpp`) —
later phases may rely on earlier ones having run. The names are the ones a slow
tick prints its split under (`[tick] slow tick ... ms:`).

1. **sessions, persist, bot population** — per-session housekeeping (rate
   allowances, squad invites, guild presence), the update and restart
   schedules, the periodic write-back of every playing account, and the bot
   roster. These run on every tick, idle or not.
2. **The idle gate.** With no human in the world — a bot has no session and
   does not count — there is nothing to simulate, and the tick ends here, after
   flushing the command buffer (a disconnect's queued destroy must not keep the
   departed body in the world). The world freezes: mobs stop wandering,
   lifetimes stop burning down, the despawn census does not run. Past a grace
   period with nobody online the bots are retired too.
3. **bot ai** — bots decide against the world as this tick found it, and the
   very next stage consumes the decision.
4. **players, petals** — petal modifiers are folded first, so a speed petal
   equipped this tick moves the flower this tick; then the flowers move, and
   each ring is placed on its owner's committed position.
5. **broadphase** — the player lists (every flower, for the mob LOD and the
   spawner's wake pass; humans only, for the arena and maze fill) and the grid
   are rebuilt from where the flowers now stand. Projectiles keep a broadphase
   of their own, and an intangible mob is in neither.
6. **contact** — afflictions tick first, then flower and petal contact, before
   any mob moves: a mob cannot escape a petal it was already touching by moving
   first.
7. **mob ai, mob movement** — then the projectiles fly, taking their bearing
   from where the mobs ended up; mob-on-mob separation runs after both, and the
   loose petals are settled against where the mobs finally stand. The rings
   mobs carry are placed after their bodies move.
8. **regrid, combat** — the grid is rebuilt, so a cell crossing cannot hide a
   real overlap, then lightning, projectile hits and ground fields.
9. **spawning, modes+npcs** — the bands are stocked and woken; then dungeons,
   the arena and maze fill, and the NPC sites.
10. **loot, banking** — drops and pickups; then pickups and kills are handed to
    the accounts (the loot system knows nothing about the database), and boss
    spawns are announced.
11. **splitters** — a splitter half that died this tick leaves its session
    before the reaper meets it.
12. **control** — flower control, an admin steering another player's flower
    (`server/admin_dashboard.cpp`), is ended here once it stops making sense:
    either flower died or left the world, the two are in different realms, or
    the admin no longer has the standing to hold it. After the splitters, which
    may have moved the steered flower onto its other half, and before the
    reaper, so the admin's view is back on their own flower before either
    corpse is announced.
13. **reap** — `reapDead`, then the `CommandBuffer` is flushed.
14. **replicate** — only on a tick that reaches the snapshot deadline,
    `net::kSnapshotsPerSecond` (20 Hz). Physics and combat want the tick's
    resolution and clients do not, and the per-recipient encode is the largest
    thing in the tick that nothing simulated depends on. The deadline steps
    from itself, so the send rate does not slew with tick jitter, and one-shot
    events are banked across the ticks that send nothing.
15. **send** — every connection's queue is flushed.

Deaths mark `Dead` rather than destroying, so everything later in the same
tick still sees the entity — loot reads a dead mob's contributor list. The
reaper turns each death into a kill event and destroys the dead after every
system has run and before replication, so the snapshot that follows no longer
describes them. A player's corpse is the exception: it keeps its `Dead` tag —
that is what puts the dead face on the wire and makes every system step over
it — and lies where it fell until it is revived or replaced. So does a bot's,
because bots revive each other.

## Realms

`shared/game/realm.h`. Every authored map, the PVP arena and the daily maze are
**separate coordinate spaces**, each with its own origin at (0, 0). The first
map in `maps/maps.json` is realm 0, the overworld; the arena and the maze are
realms 1 and 2; every further map, and every copy of one (`copies`), is a realm
of its own from 3 up (`worldRealm()`), up to `kMaxRealms`. Every `Transform`
carries the `Realm` its position is in, copied from whatever spawned the
entity: a petal from its flower, a drop from its mob, a shot from its shooter,
a nest's escort from the nest. A teleporter that leads to another map is a
`RealmChange`: the client clears its view, adopts the new map's grid and snaps
its camera. [maps/README.md](../../maps/README.md) has the manifest's rules.

The TypeScript version put the arena at (150000, 150000) and the maze at
(200000, 200000) inside one world space and guarded every clamp, section
lookup and grid individually. Here nothing in one realm can reach another by
construction:

* **Terrain** answers per realm. `Terrain::blocked`, `inWater`,
  `resolveCircle`, `segmentBlocked`, `hasLineOfSight` and `findOpenSpawn` all
  take a `Realm` (no default, on purpose): a world map is its authored
  collision shapes -- the polygons and rectangles each tile carries in Tiled,
  placed per cell from every layer marked `has_collision` and cancelled under
  a layer marked `negate_collision` (a bridge deck, resolved once at load so
  that every view agrees), with the one-value-per-cell tile grid kept beside
  them as the coarse view the flow field and the fast reject use (the minimap
  draws the shapes themselves, through `Terrain::collisionRingsAt`, because a
  coarse cell paints a tunnel shut) -- the maze is `activeMaze()`'s corridor
  lattice, and the arena is open floor inside a ring.
  `Terrain::clampInside` is the realm's closure — the map's rectangle, the
  maze square, or the ring's inside face — and replaces the old world clamp.
* **Broadphase** — `SpatialGrid` keeps one layer per realm; `insert` files an
  entity under its realm and `query` names the realm it asks about, so a
  candidate list never crosses. The movement system's separation grid and the
  petal attraction grid are the same class and follow the same rule.
* **Replication** streams a viewer only its own realm, squadmates included;
  positional events carry a realm and are filtered the same way.
* **Player lists** are `RealmPoint`s (position + realm): the mob LOD gate, the
  spawn census and the separation gate all pair a mob only with flowers in
  its own space.
* **Population** — `SpawnSystem` stocks the **spawn bands** the map's author
  drew on it, and nothing else. A band owns a population of its own, sized by
  its outline's area (`kTargetMobDensity`), and holds all of it all the time —
  as `LatentMob` records, a position, a type and a tier, which become entities
  only when somebody's viewport reaches them and go back to being records once
  nobody has been near for a while. What the world contains follows its area;
  what the tick simulates follows its players. Bosses and the target dummies
  are placed live and stay live. Ground no band covers grows nothing, ever, and
  a map with no band on it is empty and says so on its load line
  (`NO SPAWN BANDS`); `maps/README.md` has the format. The one mob that stands
  on unbanded ground is a child its parent put there rather than a band — a
  nest's escorts, which come up out of its middle, a centipede's body, laid
  straight back from its head — and the parent is inside a band.
  `ModeSpawner` (`server/systems/mode_spawning.*`) fills the arena (a crowd
  that scales with the duellists, garden roster plus spider) and the maze
  (`kTargetMobDensity` again, a stocked band's density across every corridor,
  depth-zone tiers, ultra bosses in the deepest rooms) whole, with live
  entities, while anyone is inside; the census keeps those mobs alive on the
  same condition and drains them afterwards. Those two realms are generated
  rather than authored — there is no object layer to draw a band on — so they
  are deliberately exempt from the rule above.
* **Joining** — the spawn picker's `"pvp"` and `"maze"` are realm choices, not
  biomes. `JoinAccepted` carries the realm and the maze day; `MazeInfo`
  restates the day when `change-maze` rotates it. The client builds the same
  walls from the day alone and draws the ground the realm calls for (tiles,
  maze walls, or the arena ring), the maze minimap, and the arena scoreboard.
* **The arena run** plays on a scratch `PlayerRecord` (`Session::arena`):
  starter ring, empty bag, no talents, flat 100 health, players hostile to
  each other (`Faction::friendlyFireEnabled`), XP earned doubling as
  `ArenaScore`. `GameServer::liveRecord` is what every inventory and loadout
  handler reads, so the account is never touched by a run; a quarter of the
  run's loot reaches the account when the body leaves, and a death hands the
  run to the killer.
* **The maze track** — a maze body plays the account's loadout one rarity down
  (orbiting slots still above mythic are benched), locked for the run, and its
  XP and talents are `PlayerRecord::mazeTotalXp` / `mazeSkills`, never the
  outside level.

## NPCs

`shared/game/npc.h`, `server/systems/npcs.*`. An NPC is its own entity type —
`NpcTag` on the server, `net::EntityKind::Npc` on the wire — built out of a
MOB's config: a mobs.json entry with an `npc` block saying which side it
stands on and what service it offers. That one entry is two creatures:

* **the NPC**, placed by a map's `npcs` layer or by `spawn_npc` on the admin
  console. No Motion and no AI, and not a MobTag entity, so nothing that hunts,
  farms, homes on, drifts or recycles mobs can see it. One whose mob flies
  like a bee cruises about its home on the bee's own step (`stepBeeCruise`,
  which the bee AI runs too), leashed by `NpcSystem`. Flowers are pushed out
  of every NPC's body in the player movement pass
  (`MovementSystem::pushOutOfNpcs`), and loose petals in theirs
  (`collideLooseBodies`); nothing else collides with one. It wears its mob's
  Health, Armor and Afflictions at its tier, and its pool NEVER MOVES —
  applyDamage lands a hit on it (flash, number, DPS) and takes nothing off. On
  the players' team it refuses every hit outright (`CombatSystem::canHit`); on
  another — the target dummy, on the hostiles' — it takes every hit its side
  allows, and carries its mob's `ContactDamage`, so its body bumps and bites a
  flower and a petal striking it pays its recoil, as on the mob. Flower-vs-NPC
  body contact is measured with `kNpcTouchSlack`, because the flower is always
  flush, never overlapping. The dummy's DPS readout counts only damage events
  the replicator marks `net::DamageByViewer` (the viewer's own hits, either
  split half included). `NpcSystem` keeps every map site stocked and sets each
  NPC's facing -- a cruiser's is the step it just took, a stander's the
  nearest flower -- which is all its eye needs. The client draws the mob's
  plate over it, the bar full and in the spawn-shield yellow a flower's turns;
* **the mob**, from an admin's `spawn` — an ordinary enemy with that entry's
  stats and AI.

What each service does, what it costs and how often, and how a map places an
NPC, is the author's view in [maps/README.md](../../maps/README.md) (`npcs`);
the numbers are constants in `shared/game/npc.h`, the oracle's price
`oracleCraftCost` in `rarity.h`. The engine side is the same for the oracle,
the trader and the titan:

* **Reach is checked by the server.** Standing within `kNpcServiceReach` of
  one turns the craft key's panel into that service's (`OraclePanel`,
  `TradePanel`, `TitanPanel`). The request (`ClientMessage::OracleCraft`,
  `Trade`, `TitanForge`) names no NPC: the server finds the nearest one itself
  and refuses unless the body stands at one, so a client cannot claim an NPC
  it is nowhere near.
* **Waits live in memory.** The oracle's and the trader's per-account waits
  (`GameServer::oracleReadyAt_`, `traderReadyAt_`, keyed by userId, on the tick
  clock) are never written to the database: a relog keeps them, a restart
  clears them. The profile carries what is left of each as a duration, so the
  client's countdown never depends on its own clock agreeing with the server's.
* **They are painted** (Rendering), not documents, because each one looks at
  something: its facing arrives as an attribute and moves its eyes. The
  oracle (`$oracle`) waves its tendrils and turns its eye. The trader
  (`$trader`) is a player's own face -- its eyes drawn by the one
  `paintFlowerEyes` every flower uses, at a flower's eye travel -- in a ring of
  basic petals outlined only on the outside. The titan (`$titan`) is a grey
  cog round a flower's face set to a scowl, its glints moved as a flower's
  pupils are.

The titan has more engine to it than the other two:

* **A universal forged there is exclusive.** `GameServer::takeUniversals`
  takes every universal of that petal from every OTHER account, bag and
  loadout, online or not, refunding each holder and telling a live one at
  once; a forge of a petal the forger already holds at universal is refused.
  An admin account is outside the rule both ways: its forge takes nothing from
  anyone, and nobody's forge takes its universals.
  Picking a petal on the card asks `ClientMessage::TitanHolder` who holds it,
  and the card quotes the titan remembering forging it for them; the server
  answers only a flower standing at the titan, at most every
  `kTitanHolderQueryMillis` per session, from a short memo a forge updates.
* **It is the one NPC that FIGHTS.** Its mobs.json `npc.petals` is a loadout,
  worn at `npc.petalRarity`, and `PetalSystem` runs that ring through the very
  passes a flower's goes through (`ringNpcs_` beside `players_`) — everything
  player-only in them is read as optional, and `recomputeModifiers` stops short
  of the flower's level-sized body for it. Its petals carry its players'
  Faction, so they hit mobs, never flowers, and credit nobody: a mob only the
  titan hit pays no XP and drops nothing. Its body bites mobs too, and it
  cruises about its point on the oracle's leashed flight (`bee_ai`). It stands
  at universal on its plate (an NPC alone may; its stats read apex).

The craft key's four cards -- `CraftingPanel`, `OraclePanel`, `TradePanel`,
`TitanPanel` -- are one SLOT CARD (`menus.h`, `ui/menu_slot_card.cpp`), laid
out against the trade reference shot: the frame and its anchoring, the slot
and the action button either side of the centre line, the line of text, the
tier grid (`SlotGrid`, through unique, or through apex for the trader) and the
oracle's and trader's landing (`SlotFlourish`). Each panel keeps its own
staging, animation and input, and says per cell what its grid shows; the forge
turns its ring of five about the slot's centre where the other two hold one.
The titan's card is the same card cut down to one row of `SlotTierGrid` (every
apex stack, greyed below the forge cost), with florr's own forge ring --
full-size slots on a pentagon -- and three lines of text.

## Networking

`shared/net/`. `[u32 length][u8 type][payload]`, little-endian, no type tags
inside a payload. Over TCP natively and over WebSocket or WebTransport in an
emscripten build -- see Transports below; the framing is the same either way.
`protocol.h` is the single source of truth for message ids and field order;
both sides read it.

* `Listener` (server) and `Dialer` (client) both drive a `poll()` loop and hand
  whole frames to a `TransportHandler`.
* A malformed length prefix — anything over `kMaxFrameBytes` — drops the
  connection before anything is allocated; a truncated frame yields a zeroed
  message the handler discards. Neither can corrupt state.
* **The handshake.** A client's first message is `Hello`: its
  `kProtocolVersion` and the hash of the content it was built with. The server
  answers `Welcome`, accepting, or refusing with a reason and closing — before
  either side can misread a byte of the other's. **Bump `kProtocolVersion`
  whenever any message layout in `protocol.h` changes**, and ship the client
  and the server together. This file deliberately pins no version number;
  `protocol.h` holds it.
* **Once per socket.** The client sends `Hello` from `NetClient::onConnect`,
  which the transport calls once per dial, and the server closes a connection
  that sends a second one. A repeat used to put the session back to its
  signed-out stage with its flower, its account and any temporary grant still
  attached, and everything that looks after a body asks whether the session is
  playing — so the flower stood in the world for nobody, unsaved, and every
  (Hello, Resume, Join) a script sent left another. The close goes through the
  ordinary disconnect, which saves the flower and takes it out. As a second
  line, every path that takes a body out (the disconnect, a sign-out, a re-auth
  from inside the world) keys on the session holding a body rather than on its
  stage, and a join never puts a new body down over one still held.
* **The content hash** (`ContentRegistry::contentHash`, folded in
  `ContentRegistry::load`, `shared/game/config.cpp`) is FNV-1a over the raw
  bytes of, in this order, `mobs.json`, `petals.json`, `mob_drops.json`,
  `maps.json`, and every map the manifest names, in manifest order, each
  followed by the tilesets it names. Raw bytes, so even reformatting a file is
  a mismatch; the drop table because both sides read it — the server's loot
  rolls it, the client's gallery quotes its chances; the tilesets because
  every collision shape lives in them.
* **A refused client does not redial** — the server would refuse the same
  build every time. The browser client reloads the page once instead
  (`client/web/reload.h`): the bytes that would agree are on the server that
  refused it, and only a page load fetches them. The guard is a
  `sessionStorage` key, cleared by the next handshake that succeeds, so a
  second refusal in one page session — a half-finished deploy, a proxy serving
  yesterday's wasm — shows the refusal rather than reloading forever. A native
  client has nothing to reload and shows the refusal.
* Snapshots are per-client and viewport-scoped: what is near the viewer's view
  in every snapshot, and a far band past it in one snapshot of every few
  (`Replicator::farSnapshotStride`). An entity entering view is sent once as a
  spawn record (net id, kind, type, rarity, flags, and its current position,
  facing, size, health and state); afterwards only the fields in its
  `UpdateFields` mask, and only when they differ from what that client was
  last told.
* `NetId` is a never-reused u32, distinct from `Entity`, so a client that missed
  a removal cannot apply an update to the wrong thing.

## Client motion

The client predicts nothing (`client/interpolation.h`). It runs no movement
simulation of its own — not even for the viewer's flower — so there is nothing
to reconcile and nothing to snap back. It used to predict and reconcile, and
two things made that jitter badly: the prediction integrated velocity with no
terrain at all, so walking into a wall predicted straight through it and was
yanked back on every snapshot; and the camera is pinned to the flower, so a
correction of any size jolts the whole world. The cost is input latency of
about half a round trip plus the ease's time constant, and it is the trade the
TypeScript client — and gardn before it — made on purpose.

What it does instead, per kind (`WorldView::interpolate`,
`client/world_view.cpp`):

* **Flowers** — every flower, the viewer's included, eases toward its latest
  authoritative position with one time constant, the settings panel's
  Interpolation slider. A gap wider than `kTeleportSnapDistance` is a portal, a
  respawn or a maze rotation, and is cut rather than glided across. Facing
  comes straight off the wire, because it drives the eyes and an eased one makes
  the pupils swim.
* **Mobs and NPCs** — played back from a short sample history, behind the
  render clock by an adaptive delay: the longest gap the snapshot cadence
  produces (one tick and two, alternately) plus the worst lateness the
  connection has shown lately, bounded by `kMobRenderDelayMillis` and
  `kMaxMobRenderDelayMillis`, and slewed rather than set, because changing the
  delay is changing playback speed. Every snapshot adds a sample to every
  buffered mob, the ones it did not mention included: the server leaves out
  what has not moved, and absent means "where you last had it". Past the
  newest sample a mob is extrapolated at most one sample, then held. Facing is
  eased, because passive AI turns up to 180 degrees in one server step.
* **Petals** — a ring petal is eased in its owner's frame (or its owner's moon)
  and put back on the owner's DRAWN position, so a ring never trails the flower
  it hangs off. A loose petal, like a drop, a projectile or an effect, eases its
  absolute position.

Every ease goes through `client/ease.h`: `1 - e^(-step / tau)` of the remaining
gap per frame — a fixed time constant rather than a fixed fraction — stepped by
the display's smoothed frame period rather than the frame's measured delta,
whose noise reads as a shimmer on anything moving. A bare
`value += (target - value) * k` tracks twice as fast at 120 Hz as at 60; do not
write one. Snapshot arrivals and mob playback are measured on one clock,
`renderClockMillis()`: two clocks were once a constant offset that pushed
playback permanently outside the sample window.

## Touch

A phone gets the same client, with three things added to it.

**The mirrored pointer.** `Window` turns the first contact down into the left
mouse button — position, press and release. Every panel, button and drag in
the client is written against `mousePressed`/`mouseDown`, and none of them
learns the difference. A finger that stays down keeps the pointer; a second
one is ignored rather than teleporting it.

**The claimed contacts.** An on-screen stick cannot be one mouse: it has to
track a finger while another holds a button. `Window::setTouchClaimHandler` is
asked the instant a contact lands, and a claimed one is kept out of the mirror
entirely — otherwise dragging the stick would drag the pointer across the HUD
underneath. `client/ui/mobile_controls.*` is what claims them: a virtual stick
that moves and aims, and Attack/Retract standing in for the two keys. It is a
port of the TypeScript client's `src/graphics/mobile-controls.ts` (in history
at `d47055a7`), with every size multiplied by the design units a CSS pixel is
worth on a phone (see the file's header) and shrunk further on a viewport too
narrow to lay the three out side by side.

They come up on a coarse pointer, or once the window has seen a touch, without
being asked, and the Settings panel's **Request Mobile** row is what overrules
that in either direction (`ClientSettings::touchControlsWanted`). `--mobile`
(`?mobile` on the web page) forces them, which is how a scripted screenshot run
shows them on a desktop.

**The keyboard.** A canvas takes no keyboard focus, so a phone browser opens
no keyboard for one however many text fields are painted on it. The web build
keeps an invisible `<input>` that IS focusable, and focusing it summons the
keyboard; the keystrokes bubble to the window, where the client's own key
handler already listens.

Two rules make that focus actually work on a phone, and both are easy to get
wrong because a desktop browser's touch emulation forgives either:

* It happens on **`click`**, not on `touchstart`. A browser only raises its
  keyboard for a focus made from a real gesture, and `click` is the event
  every one of them honours. (The TypeScript client focused its own hidden
  input from a click handler too, which is the evidence this follows.)
* The tap that asks for a keyboard is the one gesture the window does **not**
  `preventDefault`. A consumed touch produces no click at all, and a browser
  will not raise its keyboard off a touch it was told to ignore. The mouse
  events the page then synthesises from that gesture are dropped instead
  (`Impl::ghostUntilMillis`) because the mirror already delivered them —
  without that, a field tap lands twice, which the field's own click-streak
  logic reads as a double-click.

Deciding this inside the gesture is a frame earlier than any client code runs,
so every field records its box as it is painted or hit-tested
(`ui::TextFieldRegions`), the window is handed the set at the end of the
frame, and the touch and click handlers answer from it.

## Rendering

`third_party/cpp_canvas`, a Canvas2D-shaped API (`save`/`restore`,
`translate`/`rotate`/`scale`, paths, `fill`/`stroke`, `fillText`,
`drawCanvas`), vendored and locally modified. A frame is one draw list issued
against it, and the two builds consume that list differently:

* **Natively** it is a software rasterizer — a large fill is split across
  scanline bands on a small thread pool — presented through an SDL2 window. The
  native client is CPU-bound by it, which is why even the dev flavour is
  optimised.
* **On the web** nothing is rasterised in wasm and no framebuffer is
  allocated there. Each call is written into a buffer in wasm memory and the
  frame's worth is handed to the page's `CanvasRenderingContext2D` at once —
  at the end of the frame, or earlier when something has to observe the calls
  (a switch to another render target, a readback, a blit). Each call used to be
  its own crossing into JavaScript, and a profile put about a third of the
  main thread in those crossings. Style strings are interned and sent once.
  The web link carries no SDL or WebGL layer at all.

A mobs.json or petals.json entry's `image` is one of two things:

* **An inline SVG document**, compiled once by `SvgDocument::fromString()` into
  canvas calls and fitted into whatever box a call site asks for
  (`client/render/sprites.*`). Nearly every petal is one, and a few mobs.
  `$sponge:<body>,<detail>` is a palette marker that expands into one built-in
  document, because the sponge petal and both sponge mobs are the same vector
  in two colours.
* **A `$marker` naming a painter** in `paintMobArt`
  (`client/render/mob_art.h`) — most mobs now, and the moon petal. A painter
  generates its geometry every frame from the radius and a clock, which a
  fitted document cannot: a bigger rock has more facets rather than bigger
  ones, legs step with the ground covered, the oracle's eye looks at
  something, a leech is one tube through its segments. Painters are pure
  functions of their attributes, so the world, the gallery and a contact sheet
  all draw the same picture.

Draw order per frame in game (`App::frame`, `client/app.cpp`): the world,
the HUD (minimap and touch controls included), the chat, the menu layer
(the icon strip, the death card, the loadout bar, and the open panel over all
three), the disconnect banner and the stats corner when they are up, the
tutorial card, the text-selection highlight, and the scene wipe last of all.
There is no drawn cursor: the window sets the system cursor's shape each
frame.

Within the world (`WorldRenderer::draw`, `client/render/world_renderer.cpp`):
the ground — the map's tile layers and map elements, the maze's walls, or the
arena ring — then entities **by kind, not by position**, in the order `kOrder`
declares: `Effect` (ground effects) → `Npc` → `Mob` → `Player` → `Petal` →
`Drop` → `Projectile`; then the transient effects, lightning under the damage
numbers; then chat bubbles, over everything. Petals go over players on
purpose: petals below players was the visible error, a petal passing in front
of a flower going behind its face. Three exceptions: a loose petal lies in the
NPC layer, a mob's own ring of petals goes down in the mob layer under the
bodies, and holes and wave-sending nests go first among the mobs, so what comes
out of them stands on them.

## Building

[README.md](../../README.md) has the commands and the prerequisites;
`cpp/CMakeLists.txt` and `scripts/build-web.js` explain their own choices in
their comments. One tree builds both ways. Natively it yields
`flowrix_server`, `flowrix_client`, `flix_tests` and the tools; under
`emcmake` it yields the web build below. The tools and the tests are native
only.

`-DFLIX_BUILD` picks the flavour, and is the only build knob: `CMAKE_BUILD_TYPE`
follows from it rather than being set alongside it, so there is one way to say
which build this is.

* **`dev`** (cmake's default) — `-O2 -g`, `assert()` live, frame pointers kept.
  Still optimised, because the native client rasterises every pixel on the CPU
  and an `-O0` build does not reach a frame rate anything can be judged by. It
  also defines `FLIX_DEV_BUILD`, which leaves the account abuse limits
  unenforced (`server/account_limits.h`) — a compile definition rather than a
  runtime flag, so that a release build cannot be talked into it.
* **`release`** — what ships: `-O3`, `NDEBUG`, no debug info. The npm scripts
  pin it (`build:dev` aside) rather than reading the environment, because they
  are the commands that produce what ships.

Two things the configure needs that are easy to miss: natively it requires
pkg-config, SDL2 and threads even to build only the server, and the first
configure of a build directory downloads Ubuntu Bold — from Google Fonts'
repository, at a pinned revision, checked against its SHA-256 — into the
staged content directory, so it needs the network once.

## The web build

`emcmake cmake` builds the same tree for a JavaScript runtime: the client as a
page, the server as a Node program, and the offline page that is both (below).
`scripts/build-web.js` is what `npm run build` runs: it configures
`cpp/build-web`, builds the two deployment targets and stages them in `dist/`.
Its header and the comments in `cpp/CMakeLists.txt` are the reference for the
exact outputs and link flags; what they add up to:

* **The names are the TypeScript build's.** The page's script is `bundle.js`
  and the server is `server.js`, so nginx, pm2 and the update zipball did not
  have to learn new ones when the C++ build replaced it; the link names the
  page `bundle.html` and staging renames it `index.html`. Only the web build is
  renamed, by `OUTPUT_NAME` at the link: the native binaries are
  `flowrix_client` and `flowrix_server`.
* **The two files the page downloads ship deflated as well**, as
  `bundle.js.bin` and `bundle.wasm.bin`. `compress()` in `build-web.js` writes
  them; the loader in `client/web/shell.html` prefers them, inflates them with
  the browser's own `DecompressionStream` and hands the wasm to
  `compileStreaming`, so the module compiles while it is still arriving. A
  first visit downloads about a fifth of the bytes. The uncompressed files
  still ship and are what the loader falls back to: a build served straight
  out of `cpp/build-web` has no `.bin` beside it, because compressing is a
  staging step and not part of the link, and older browsers lack
  `DecompressionStream`. The TypeScript client's build deflated its bundle the
  same way (`scripts/compressbundle.js`, in history); this extends it to the
  wasm, which is where the bytes are now.
* **A flavour switch is a rebuild.** `build-web.js` deletes `cpp/build-web`
  when the flavour changes: the Makefile generator does not make an object
  depend on the flags it was compiled with, so reconfiguring in place would
  relink the previous flavour's objects with the new flavour's name on them.
  The release client's link is pinned at `-O3`; a dev link keeps the
  configuration's own `-O2 -g`, because wasm-opt at `-O3` is most of the wait
  on a relink, and turns emscripten's assertions and stack-overflow check on.

Both are the same programs as the native ones — the same tick and the same
systems issuing the same Canvas-shaped draw list. The builds otherwise differ
in three places.

* **Who owns the loop.** Natively `App::run()` and `GameServer::run()` do. In a
  page the event loop belongs to the browser, and under Node it belongs to
  Node; either way, blocking it is exactly what would stop every message from
  ever being delivered. So both `main.cpp`s hand `step()` to
  `emscripten_set_main_loop_arg` and return.

* **What carries the bytes.** See Transports. The framing does not change:
  `[u32 length][u8 type][payload]` is what finds message boundaries, and it
  does so identically whether the bytes arrived as discrete WebSocket messages
  or as a QUIC stream that split and coalesced them however it liked.

* **Where the content lives.** `--embed-file <build>/data@data`, not
  `--preload-file`: the whole staged content directory is inside each wasm.
  The client reads all of it synchronously during `start()`, so there is
  nothing to gain from a fetch it would have to wait for; a single artifact
  cannot half-deploy the way a `.wasm` and a stale `.data` beside it can; and
  the server has no page to run a preload from at all. The staged files are
  link dependencies, so a data-only edit relinks both wasms. The server's one
  real directory is its database's, mounted from the host
  (`mountDatabaseDirectory`, `server/main.cpp`), with a relative `--db`
  resolved against Node's working directory.

`client/web/shell.html` is the page. It does no rendering and picks no
transport: it fetches the glue and the wasm (compressed, as above), hands the
wasm the canvas element and the argv `main()` would have had natively, and
links Ubuntu Bold from Google Fonts for the canvas to draw its text in. The
wasm carries only the face's metrics (`Ubuntu-Bold.metrics`): the TTF with its
outlines taken out by `cmake/font_metrics.js` at build time, about 9KB against
330KB, from which `client/ui/text.cpp` measures every run to the same bit as
the full face would, before the webfont has arrived as well as after. It
defaults to its own origin, so an untouched URL already points at the server
that served it; `?host=`/`?port=` are only for a client build hosted somewhere
else.

## dist/ and shipping

`dist/` is committed because it is what deploys: `/admin update` installs the
`dist/` out of the `web` branch's GitHub zipball, so the branch IS the build,
and a fresh clone runs the committed one with `npm run start_nobuild` and no
toolchain. It holds exactly what `scripts/build-web.js` stages for `all` —
`index.html`, `bundle.js`, `bundle.js.bin`, `bundle.wasm`, `bundle.wasm.bin`,
`server.js`, `server.wasm` and `favicon.ico` (from `cpp/client/web/`) — and
nothing else. The live database beside them (`dist/inventory.json`, and its
`.tmp` while a save lands) and the offline pages are gitignored, which is also
why the archive can never carry a database. README.md's "Shipping a change" is
the checklist; the reasons behind it:

* **A build embeds its tree.** Both wasms carry the staged content, and the
  handshake compares a hash of its raw bytes. A `dist/` built from a tree with
  an uncommitted data or map edit holds a client that handshakes with nothing
  but a server built from that same tree, and one built with uncommitted code
  ships code the commit does not have. Build what you commit from a clean
  checkout of it — a `git worktree` of HEAD will do.
* **A `.bin` travels with its file.** The page prefers the `.bin`, so a
  `bundle.wasm` shipped without its `.bin` is served as yesterday's client,
  whose only symptom is a refused handshake.
* **No npm runtime dependency.** The update never runs `npm install` and leaves
  each box's `node_modules` alone (it holds native builds for that host), so a
  package the server reached for would be missing on every deployed box, and
  the server would not start. That is why the WebSocket server is written out
  in `web_channel.cpp`; the only packages are the optional WebTransport pair,
  which a box installs for itself.

`/admin update [now|<N>(s|m|h)|status|cancel]` (`server/auto_update.*`) is the
Node build's alone: a native binary is not in the zipball, and the offline
page has no directory to install into.

1. The database is backed up first, by the server rather than the installer;
   a failed backup aborts before a file is touched. The snapshot goes in
   `db_backups/` one level above the database's directory — `~/db_backups`
   for a server in `~/dist` — which is outside `dist/`, and so outside the one
   directory the Node build used to mount from the host: every snapshot landed
   in the wasm's in-memory filesystem, reported a real-looking path, and was
   gone at the restart it was taken for. `server/main.cpp` now mounts that
   directory too, by the same rule the writer uses
   (`Database::backupDirectoryFor`), and `Database::backup` asks Node's own
   `fs` whether the file is on the host's disk at its full length before it
   counts — so a mount that failed is a refused backup and an aborted update,
   never a phantom. The directory is shared with whatever wrote snapshots there
   before (the TypeScript server, an operator), under the same
   `inventory-<time>-<label>.json` pattern this server used to write, so this
   server names its own `….snapshot.json` and prunes only those, to the newest
   30 (`kMaxDatabaseBackups`); every other file there is listed by
   `backup_db list` and never deleted.
2. The zipball is downloaded (`codeload.github.com/flowrix-io/florr_clone`,
   branch `web`; `FLORR_UPDATE_REPO`, `FLORR_UPDATE_BRANCH` or
   `FLORR_UPDATE_URL` override it), unzipped with the host's `unzip`, and
   searched for the `dist/` that holds a `server.js`.
3. That is **overlaid** onto the directory the running `server.js` was loaded
   from: every file copied over, none ever deleted, and `inventory.json`,
   `node_modules`, `db_backups`, `cert.crt` and `cert.key` at the top level
   never touched. Safe while the server runs, because Node read the build into
   memory at start-up.
4. A restart is scheduled — a minute out unless told otherwise — and the
   restart is what loads the new server.

Because the overlay never deletes, a box keeps whatever a later `dist/`
dropped — the compiled TypeScript that used to sit there, for one. That is
harmless: the static handler serves only the web build's own names (Serving
the client). The page's files are read from disk per request, so the next page
load gets the new client even before the restart, and an open page that the
restarted server refuses reloads itself once (Networking).

**The server's exit code says whether it wants to come back.** An ordinary
shutdown — SIGINT or SIGTERM, which is what Ctrl-C, `pm2 stop` and
`pm2 restart` send — ends the loop the ordinary way: every playing account and
the database are written (`GameServer::shutdown`) and the process exits 0.
Natively `std::signal` catches both. Under Node a C handler is never called
and a signal nothing listens for kills the process with nothing saved, so
`server/main.cpp` listens for both with `process.on` once the server is up,
and the main loop makes the same `stop()` on its next pass. A `restart`, and
the restart `update` schedules once its install lands, exit **1**, the one code
every supervisor restarts on. pm2's default `autorestart` restarts a process
after any exit, 0 included, but systemd's `Restart=on-failure` (like docker's
`on-failure`, and pm2 once 0 is in its `stop_exit_codes`) reads 0 as "this
process was meant to end" and leaves a cleanly-exited server down, which would
turn a restart into a shutdown with a countdown and nothing coming to undo it.
`GameServer::exitCode()` carries which of the two it was out of the loop, and
`server/main.cpp` returns it — natively as the process's status, and under
Node through `process.exit`, because a Node that merely runs out of work
exits 0, and with the listeners in, a signal no longer ends it by itself.

## Serving the client

The wasm server serves the client itself, over the same port it plays the game
on:

```
node cpp/build-web/server.js --port 4242 --db cpp/build-web/inventory.json
# serves cpp/build-web: the web root defaults to the module's own directory
```

One process and one origin for the page, the WebSocket, the QUIC listener and
`/transport-info`. Nothing else has to be running, and the page is same-origin
with its server — which is what a secure context needs before WebTransport is
possible at all. `npm start` and `npm run start_nobuild` run the staged build
from the repository root, as `node dist/server.js --port ${PORT:-3000}` with
`--db dist/inventory.json --web-root dist`.

* **HTTPS when there is a certificate.** `--cert`/`--key` name a pair; with
  neither, `cert.crt`/`cert.key` (a real certificate, installed by hand) and
  then `dev-cert.crt`/`dev-cert.key` (the localhost pair `npm run dev:cert`
  writes) are looked for in the working directory. **Validity decides, not
  order**: the first unexpired pair wins, because either can be left lying
  there past its dates while the other is current, and serving the dead one
  would cost every browser the connection and cost WebTransport its pinnable
  digest. Finding nothing serves plain HTTP, and WebSocket is then the only
  transport on offer. No certificate is committed, so a fresh clone serves HTTP
  until one is made.
* **Nothing regenerates a certificate.** An expired one is reported in the log
  and served anyway, and browsers refuse it. `scripts/gen-dev-cert.js`
  (`npm run dev:cert`, which needs the `openssl` command) is the one writer of
  the dev pair, and a real certificate is renewed by whoever installed it; two
  writers is how those files come to disagree. The dev pair is ECDSA P-256
  with a 13-day life because the server publishes a digest (`certHashes` at
  `/transport-info`) only for a certificate valid 14 days or less — the only
  kind a browser accepts pinned by hash, which is what lets localhost
  WebTransport work with no trust-store setup. The flip side is that it expires
  quickly, and is made again by hand.
* **`--web-root`** is the directory served, defaulting to the directory the
  server module was loaded from — which is where the client build already is.
  **Only the web build's own files are served**, by name, from the top of the
  root: `index.html` and `bundle.html` (either answers `/`), `bundle.js`,
  `bundle.wasm` and their `.bin` copies, `favicon.ico`, and the offline pages
  where they have been built. Any other path gets the same 404 whether or not
  the file exists. The root is not a directory of web content: on a deployed
  box it is `dist/`, which is also the server's working directory, so the live
  database and the certificate pair sit beside the page — and a handler that
  served whatever a path named handed every account's password hash and the
  TLS private key to anyone who asked. The game's content is embedded in the
  wasm, so the page needs nothing else from here. Paths are still decoded,
  normalised and required to stay under the root; `.wasm` is served as
  `application/wasm` so the browser will stream-compile it; and every file is
  sent `no-cache` and read from disk per request.
* **Unchanged files cost a 304, not a download.** `no-cache` means "ask every
  time", and asking needs something to ask about: every file goes out with a
  strong `ETag` (its size and modification time, to the nanosecond) and a
  `Last-Modified`, and a request whose `If-None-Match` names that tag — or,
  with no `If-None-Match`, whose `If-Modified-Since` is no earlier than the
  file — is answered `304` with no body and no read of the file, for `GET` and
  `HEAD` alike. The page fetches its bundle with `cache: 'no-cache'`
  (`client/web/shell.html`), so a reload of an unchanged build revalidates the
  megabyte of wasm instead of downloading it again, and a rebuilt file, whose
  tag has moved, is downloaded in full. Without the validators every load was
  a full download.
* **`/transport-info`** is the server's advertisement: whether it offers
  WebTransport, on which port and path, and the certificate digest when there
  is one to pin. See Transports.

## The offline build

The third web target is the whole game in one file:

```
cmake --build cpp/build-web --target flowrix_offline   # -> offline.html
npm run build:offline                                  # the same, staged as dist/offline.html
```

`offline.html` opens from disk — double-click it, or `file:///…/offline.html`
— with no server running and no network. It is not a third program:
`offline/main.cpp` starts the shipping `GameServer` and the shipping `App` in
one wasm and steps both from one `requestAnimationFrame` callback, the server
first so that this frame's input is simulated before this frame is drawn. The
two talk over the same `Listener`/`Dialer` pair as the network build, over the
in-page loopback described under Transports. Bots, the maze, squads, the
console commands — everything the server does, it does here, for one player.

What makes it one file is `-sSINGLE_FILE`: the wasm is embedded in the script
and the script in the page, so nothing is fetched. That is the whole
requirement — a page opened from a `file://` URL may not fetch a `.wasm` beside
itself — and it is also why the page references nothing else: no stylesheet,
no favicon, and no Google Fonts. It is the one build that embeds Ubuntu Bold
itself, and registers it with the document (`FontFace`) at startup, so the
canvas draws in the face whose metrics the client measures with. The file is
several megabytes, and `dist/offline.html` is gitignored so a rebuild does not
land in every commit of the otherwise committed `dist/`.

State lives in the browser's localStorage, under the `flowrix-offline/` prefix
so that a copy of the page served from the game's own origin never presents the
online client's session token to a server that has never heard of it:

* the client's settings and session token, through the same
  localStorage-backed WasmFS mount the online client uses
  (`client/web/persist.cpp`);
* the account database, mirrored **by path** (`restoreFile`/`mirrorFile` in
  the same file): copied back into memory before the server opens it, compared
  against storage once a second and written when it changed, and flushed,
  along with every playing account (`GameServer::persistAll`), whenever the
  page is hidden or goes away (`pagehide`, and a hidden `visibilitychange`).
  It cannot share the mount, because the mount pairs a storage key with the
  file object it created and the database is written atomically — a temp file
  renamed over the old one — so every save would be a new object the mount has
  no name for.

A scheduled `restart` is honoured the way a process restart would be: the
page reloads, which is "the same build, started fresh". `update` answers that
there is nothing to install into. Without storage (a private window) both
halves still run and simply forget, as the online client does.

One thing this page has that no other build does: **Grant Admin**, in
Settings > Advanced. The server is in the player's own tab and the world is
nobody else's, so the console is theirs to take; the alternative is editing an
account out of browser storage by hand. The button calls
`GameServer::grantAdmin` directly, in-process, through `AppConfig::grantAdmin`
— a hook only `offline/main.cpp` sets — and hands it the session token the
page's own client was issued, never a name: the server resolves the account
from that token (`Database::resolveSession`), so the grant lands on whichever
account the client is signed into and nothing a player types can aim it.
Nothing on the wire carries the grant, so a client dialling a real server
draws no button and the shipping server gains no way to hand itself the
console. What it sets is the permanent `Account::admin` flag (not the one-life
loan `/admin grant_admin` lends), and the server answers by resending the skin
catalog, whose leading flag is where a client learns its own standing. The
page's database editor key is fixed (`ServerConfig::fixedAdminDbKey`, set by
`offline/main.cpp` and by nothing else) rather than derived from a machine, and
since this page has no server log anybody reads, the server says it: in the
Grant Admin confirmation, and in `/admin db`'s usage line and wrong-key
refusal. A derived key, on every other server, is never said anywhere but the
log.

### Without WebAssembly

```
cmake --build cpp/build-web --target flowrix_offline_asmjs  # -> offline-asmjs.html
npm run build:offline:asmjs                                 # staged as dist/offline-asmjs.html
```

The same page for a browser with no wasm engine — an old one, or one where it
is switched off. `-sWASM=0` runs the linked module through wasm2js, which
rewrites it into the JavaScript the asm.js era compiled to, and the glue
carries a `WebAssembly` shim of its own so nothing reaches for the engine's.
Everything else is the link the wasm page uses, stated once in
`FLIX_OFFLINE_LINK_OPTIONS` so the two cannot drift into different programs.

Two differences that are not optional:

* **no `-msimd128`.** wasm2js cannot translate SIMD, and the link fails if
  `-flto`'s codegen emits any. Nothing here writes intrinsics, so this costs
  the autovectoriser and nothing else.
* **not in `all`.** wasm2js re-codegens the whole module, which takes minutes,
  so the target is `EXCLUDE_FROM_ALL` and built by name.

The page it produces is bigger than the wasm page, and slower to start and to
run. That is the trade for playing where wasm cannot.

## Transports

`shared/net/web_channel.h` is the seam. Natively `transport.cpp` moves bytes
with `socket()`, `connect()`, `accept()` and `recv()`; a browser tab has none
of those, and emscripten's BSD-socket emulation offers WebSocket and nothing
else. So the emscripten build asks this layer for whatever the runtime has:

| | native | emscripten (Node server, page client) | emscripten (offline page) |
|---|---|---|---|
| client → server | TCP | WebTransport, else WebSocket | in-page loopback |
| server listens on | TCP | WebSocket, plus WebTransport with a certificate | an in-page port |

The loopback is what the offline build plays over. A `listen()` in a page —
where there is nothing to bind and nobody outside to serve — registers an
in-page listener under its port, and a `connect()` from the same page to
`127.0.0.1` or `localhost` on that port is resolved to it directly: the two
ends are made together as a pair of queues, each one's `send` feeding the
other's receive queue, both open at once. Any other host still goes over the
network, so the Advanced Settings field can point the offline client at a real
server. Under Node the same `listen()` is a real HTTP(S) server and nothing
below changes.

Between a page client and a Node server the choice is made per connection, by
the client, while it connects:

1. `GET /transport-info` asks the server what it offers. No answer means
   WebSocket, which is the safe assumption anyway.
2. WebTransport is attempted only if the runtime implements it, the page is a
   secure context (the API requires it), and the server said yes. A
   development certificate that no public CA vouches for is pinned by the
   `certHashes` digest the server publishes, which is what makes it work on
   localhost with no trust-store setup.
3. Anything at all going wrong — no UDP path, an untrusted certificate, a
   timeout — falls through to WebSocket. One wasted round trip is the whole
   cost of trying, and it is paid once: the failure is remembered per origin
   in `sessionStorage` for the life of the tab, so a reconnect goes straight
   to WebSocket. That matters behind a proxy that carries only TCP —
   Cloudflare's, for one — where the server still advertises WebTransport on
   its own port and the handshake can never succeed.

The page dials the port it was served on: `location.port`, or the scheme's
default when the URL names none. Behind nginx or Cloudflare that is 443,
which the proxy forwards to the server's own port; only a page with no origin
port at all falls back to 3000.

The server's QUIC listener is equally best-effort: `@fails-components/webtransport`
is an optional native dependency and needs a certificate, and failing either
costs the deployment WebTransport and nothing else. Without a certificate the
listener is plain HTTP and WebSocket only, because WebTransport is
secure-context only and there would be nothing to offer — see Serving the
client above for how one is found.

Only `Connection`'s byte movement and `poll()` differ between the backends.
The framing, the frame loop, the backlog rule and the conditions that end a
connection are one implementation — `Listener::service()` — shared by all of
them, because a copy of those rules per backend is how they would come to
differ in more.

**The two pairs do not interoperate.** A native client speaks TCP and a wasm
server speaks WebSocket; neither knows the other's transport. That is a
deployment choice, not an accident: giving the native build a WebSocket client
would mean carrying an HTTP upgrade and a frame codec in C++ for a case that
has not come up.

## Chat markup

Chat content is not plain text on the wire. The server sends
`<b style="color: #2bffa4;">A super crab has spawned!</b>` and joins a long
listing's lines (`/help`, `/guild-info`) with `<br/>`. `client/ui/markup.h`
parses that subset into styled runs; the transcript in `App::drawChat` lays
those out rather than splitting the raw string on spaces, which used to print
the tags.

* `b`, `strong`, `i`, `em`, `u`, `blink`, `span`, `font`, `color` and `br` are
  honoured in every build; they are the only tags the server emits. There is
  no italic face, so `<i>` is sheared, the way a browser synthesises a missing
  one.
* `<code>` and `<pre>` are what a player types to quote something: both are
  drawn on a dark plate, and `<pre>` is a block of its own that keeps its
  spaces and line breaks.
* `<img src="https://...">` becomes a span of its own in every build, but only
  a browser can show it: the page fetches and decodes it as an ordinary image
  and draws it straight onto the canvas (`client/ui/remote_image.h`), so no
  image codec or TLS stack is linked into the wasm, and a native transcript
  prints a placeholder. Only https links on a listed image host are allowed
  (`shared/game/chat_images.h`), because a chat picture makes every reader's
  browser fetch the URL — a way to put anything on everyone's screen, or to log
  every reader's address. Both halves read that one list: the server strips a
  picture from anywhere else before the line goes out and tells the sender
  why, and the client refuses to fetch one that arrives anyway.
* `<a>` needs somewhere to navigate, so it is honoured only under
  `FLIX_WEB_BUILD` and dropped — with its content, as any unknown tag is —
  natively. Even there it is underlined rather than followed: making it
  clickable means hit-testing a chat column that overlaps the play area.
* **`script` and `iframe` are dropped with their content in every build.** The
  TypeScript client offered a "click to run" button for one and a "click to
  show embed" button for the other. Nothing here reinstates either, and no code
  path in this client executes or embeds what a chat line asks it to. If you
  are adding a tag, that is the line not to cross.

## The asset browser and boot scripts

The debug panel (Settings > Enable Debug Menu, then J or the bug button) has an
Assets button, which opens the asset browser: `client/ui/menu_assets.cpp` for
the panel, `client/ui/asset_files.h` for its file and text rules (listing,
line index, colouring, undo), which the tests cover without a window. It is
gated on the same switch as the debug panel and closes with it.

**Files.** The places are, in the browser, `/data` (the content embedded in the
wasm: in memory, so an edit lasts until the page reloads, and the game read
what it needed at startup), `/persist` (browser storage: the settings, the
session and the boot pair), `/boot` (the embedded tools) and `/`; natively,
the `--data` directory and the working directory, and "Up" stops at a place's
root. A text file opens in an editor that edits by `text_input.h`'s rules,
scrolls both ways (horizontally by bytes into every line, so a map's
single-line tile layer costs what is on screen), colours JSON, scripts and
markup a line at a time, undoes by diffs rather than snapshots, and saves on
Ctrl+S, which the editor claims from the browser while it has the caret
(`Window::setClaimedShortcuts`; every other Ctrl/Cmd combination stays the
browser's). An SVG gets a live preview; anything that is not UTF-8 text opens
as a hex dump. Saving the settings file reloads the settings from it, or the
client would write its own copy back over the edit on the way out. A new file
cannot be made in `/persist` and nothing there can be deleted: the mount keeps
only the names it was given, bound to the file objects it made
(`client/web/persist.h`).

**Boot.** What the next page load runs INSTEAD of the game. Choosing a script
writes its text and its path into `/persist/boot-script` and
`/persist/boot-path` (`client/web/boot.h`); copied, because the page has to
run it before there is a wasm to read `/boot` from. The online shell reads the
two keys out of localStorage before it fetches anything, runs the script with
`window.eval`, and hands it `Module.flixBoot` -- `path`, the storage `prefix`,
`startGame()` and `clear()` -- so a tool that never starts the game costs no
download, and one that does sets itself up first. The offline page cannot keep
its inline game from loading, so it holds `main()` back with `noInitialRun`
and `startGame()` calls `callMain`, which that link alone exports. Both shells
read `?boot=game` (skip the script once) and `?boot=reset` (forget it) with
nothing from the client, so no script can lock anyone out, and a script that
throws on the way in gets a screen with both ways out. A page started through
a script says so in chat on every load.

**The tools** are `client/web/boot/*.js`, embedded at `/boot` in the client and
offline links (globbed: a script dropped in is a tool, and its first comment
line is its summary on the Boot tab): `console.js` (the game under an
on-screen console with a JavaScript prompt, F2), `netlog.js` (the game with a
WebSocket monitor: rates, totals, busiest message types by first byte, close
codes, F3), `recovery.js` (the page's browser storage, decoded, editable,
exportable, without the game) and `diagnostics.js` (a report of what the
browser supports, whether the server answers, and how fast the game downloads
and compiles). The page's stylesheet pins every `<canvas>` full-size, which a
tool drawing a canvas of its own has to override.

## Admin

Admin rights come only from state the server holds: the account's `admin`
flag in the database (`Account::admin`, copied into `Session::admin` at
sign-in), or a one-life loan — `/admin grant_admin`, which only a flagged admin
can give or take back, and which ends when the grantee respawns, leaves the
game, logs out, disconnects or signs in as another account on that
connection; a sign-in sent from inside the game takes the old body out first,
saved, as a leave does. A sign-in as another account also leaves the squad
the connection was in and drops any squad invitation pending for it, and so
does a logout: both are keyed by the connection, and would otherwise pass to
whoever signs in on it next. The database editor (`/admin db`) asks for the
flag, not the loan, and for the key the server prints at start-up besides (the
offline page's fixed key, which it also says out loud; see The offline build).
Nothing a player chooses grants or targets a privilege: an admin command
resolves a player by account name only — bots, which have no account, by
nameplate — never by a display name, which is any string a client sent.
[README.md](../../README.md) says how to set the flag on a server you run; the
in-game dashboard is [admin-dashboard.md](admin-dashboard.md).

## Tests and tools

`flix_tests` is the one test binary, native only, built from every
`cpp/tests/*.cpp` — globbed, so a new file needs no list edit — and registered
as ctest's single test. Tests use `tests/test.h` (`TEST`, `CHECK`, `CHECK_EQ`,
`CHECK_NEAR`); a failed check is reported and the run carries on. What the
test files share is in headers beside them: `test_data.h` (where content comes
from, and the scratch files fixtures are written to), `server_harness.h` (a
real `GameServer` and real clients over loopback for the end-to-end tests, and
the synthetic maps they can boot on), `render_rig.h` (the font, camera and
pixel diff a render test reads its frame back with) and `fixture_content.h`
(hand-written mob and petal JSON with the mandatory fields filled in). Content
comes from the staged content directory, compiled in as `FLIX_TEST_DATA_DIR`,
so the binary runs from anywhere and a test sees what a server from the same
build would load.

An end-to-end test reaches the server from outside: its socket, and the world
and database it exposes. The one way past that is `GameServerPeer` in
`server_harness.h`, a friend of `GameServer` that hands a test a session by
account name. It is for the few tests that must put a session into a state no
message leads to any more — a stage that stopped saying Playing while its body
stood — to see that the guards against that state still work
(`reauth_tests.cpp`, and the split's case in `splitter_tests.cpp`).

`FLIX_TEST_FILTER=<substring>` runs only the cases whose name contains it, and
the summary then says how many of the registered cases ran; a filter that
matches none fails the run, because a run that ran nothing proved nothing. It
is also the way past a case that crashes: the suite is one process, so an
abort ends the run there, with no summary line, and every case registered
after it goes unrun.

`npm run test:ws` (`scripts/ws-conformance.js`) builds nothing: it starts the
`dist/server.js` that is already there and speaks raw TCP at it. The WebSocket
server is written out rather than taken from npm, and a client library would
hide exactly the cases that matter — an unmasked frame, a reserved bit, a
1 GiB length prefix. Rebuild the server first if you changed it.

The tools in `cpp/tools` are native only, and each file's header says how to
run it:

* `svg_smoke` — every mob and petal artwork in the config files, compiled and
  drawn into one contact sheet (a PPM); anything not drawable is marked in
  place rather than left blank. It reads the build's staged copy
  (`FLIX_TEST_DATA_DIR`, baked in by CMake) unless handed a directory — the
  repository's `data/` shows an edit without a rebuild.
* `raster_parity` — one fixed scene through the software rasterizer, as a PPM.
  Build it either side of a `canvas.cpp` change and diff the two byte for
  byte: an optimisation moves no pixels.
* `bot_probe` — boots the real server with a real bot population for a few
  simulated minutes and prints what the bots did: how often they had something
  in reach, walked into it, killed it, and how much ground they covered.
* `projectile_bench` — what a loadout full of projectile petals costs a server
  tick, and what the shooter's client downloads.
* `mob_render_bench` — what one mob type costs the mob layer, in milliseconds
  per mob, through the real `WorldRenderer`.
* `hitbox_fit` — measures each mob's artwork through the client's own sprite
  path and prints the `visual_scale` and `visualOffsetX/Y` to paste into
  `data/mobs.json`, which it reads from the source tree, so an edit is
  measured without a rebuild.

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
* No DOM UI. Every pixel of UI is drawn through `cpp_canvas`; HTML and CSS stay
  in the two shell pages, and a browser API is reached through a small `EM_JS`
  function beside the C++ that needs it — never by putting visible UI into the
  page.
