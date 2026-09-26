#include "server/game_server.h"

#include "shared/core/process_stats.h"
#include "shared/game/tiled_map.h"

#include <algorithm>
#include <array>
#include <cctype>
#include <chrono>
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <iterator>
#include <limits>
#include <optional>
#include <thread>
#include <utility>

#include "server/auto_update.h"
#include "server/bot_identity.h"
#include "server/guilds.h"
#include "server/loot_eligibility.h"
#include "server/text.h"
#include "server/systems/combat.h"
#include "server/systems/loot.h"
#include "server/systems/mob_ai.h"
#include "server/systems/movement.h"
#include "server/systems/petals.h"
#include "server/systems/spawning.h"
#include "server/systems/mode_spawning.h"
#include "shared/game/config.h"
#include "shared/game/shop.h"
#include "shared/game/skin_format.h"
#include "shared/game/skills.h"

namespace flix {

double monotonicMillis() {
    using clock = std::chrono::steady_clock;
    static const clock::time_point start = clock::now();
    return std::chrono::duration<double, std::milli>(clock::now() - start).count();
}

namespace {

/// Clamp on the viewport a client may claim. A client asking to see the whole
/// map is asking for an advantage, and for the server to build it a snapshot
/// of the entire world.
constexpr double kMaxViewportAxis = 2600.0;

/// How often account progress is written back from the live entity.
constexpr double kPersistIntervalMillis = 30000.0;

/// Ceiling on one simulation step, as a multiple of the nominal one. A long
/// stall must not be paid back as a single giant integration step that walks
/// every flower through a wall.
constexpr double kMaxDeltaSeconds = net::kTickSeconds * 3.0;
/// Low-pass factor on the step, ~a ten-tick time constant.
constexpr double kDeltaSmoothing = 0.1;

/// The batch a craft consumes.
constexpr int kCraftBatch = 5;

// The database stores petals by NAME, because that is the shape real accounts
// are already saved in; the wire uses a dense index, because a name in every
// snapshot would cost more than the whole rest of the message. These two
// functions are the only place the two spellings meet.
//
// Inventory keys additionally carry a "petal_" prefix that loadout entries do
// not. That is the old schema's one real wart, and it is load-bearing: change
// either side and every stored loadout is orphaned.

std::string inventoryKey(std::uint16_t petalIndex) {
    return "petal_" + content().petal(petalIndex).id;
}

std::uint16_t petalIndexFromInventoryKey(const std::string& key) {
    const std::string id = key.rfind("petal_", 0) == 0 ? key.substr(6) : key;
    return content().petalIndex(id);
}

/// Takes `count` from the inventory, or nothing at all when short. Never
/// partially succeeds: a craft that consumed three of the five it needed and
/// then failed would quietly destroy them.
bool takeFromInventory(PlayerRecord& record, std::uint16_t petalIndex, Rarity rarity, int count) {
    if (petalIndex == kNoPetal || count <= 0) return false;
    const std::string key = inventoryKey(petalIndex);
    if (record.itemCount(rarity, key) < count) return false;
    record.addItem(rarity, key, -count);
    return true;
}

void giveToInventory(PlayerRecord& record, std::uint16_t petalIndex, Rarity rarity, int count) {
    if (petalIndex == kNoPetal || count <= 0) return;
    record.addItem(rarity, inventoryKey(petalIndex), count);
}

/// What a brand-new account starts with.
///
/// An empty loadout is a flower that cannot fight anything, which makes the
/// first minute of the game a walk through a field of mobs that can only hurt
/// it. Five Basic petals is the smallest kit that is actually playable, and
/// the five spares beside them are exactly one craft batch -- a brand-new
/// account can walk to the crafting panel and roll its first Unusual.
/// One loadout slot as a body in `realm` actually wears it.
///
/// The maze plays the account's ring one rarity DOWN, and an orbiting slot
/// still above mythic after that shift is benched -- left empty on the body
/// and untouched on the account, which is the reference's applyMazeLoadout.
/// The storage row behind the ring shifts too but is never capped: it orbits
/// nothing, so nothing can be over-tier in it.
///
/// Both the body and the profile the client draws its loadout bar from go
/// through here, or the bar would advertise a rarity the flower is not
/// actually swinging.
WornSlot wornSlot(const PlayerRecord& record, std::size_t slot, Realm realm) {
    WornSlot worn;
    if (slot >= record.loadout.size() || !record.loadout[slot].has_value()) return worn;

    const StoredItem& item = *record.loadout[slot];
    worn.petalIndex = content().petalIndex(item.petalType);
    // A stored petal this build no longer has leaves the slot empty rather
    // than resolving to whatever index 0 happens to be.
    if (worn.petalIndex == kInvalidIndex) worn.petalIndex = kNoPetal;
    worn.rarity = item.rarity;

    if (realm == Realm::Maze && worn.petalIndex != kNoPetal) {
        worn.rarity = clampRarity(std::max(0, rarityIndex(worn.rarity) - 1));
        if (slot < kLoadoutActiveSlots && rarityIndex(worn.rarity) > rarityIndex(Rarity::Mythic)) {
            worn.petalIndex = kNoPetal;
            worn.rarity = Rarity::Common;
        }
    }
    return worn;
}

void grantStarterKit(PlayerRecord& record) {
    const std::uint16_t basic = content().petalIndex("basic");
    if (basic == kInvalidIndex) return;

    constexpr int kStartingEquipped = 5;
    constexpr int kStartingSpares = 5;

    record.loadout.assign(kLoadoutSlots, std::nullopt);
    for (int i = 0; i < kStartingEquipped; ++i) {
        StoredItem item;
        item.type = "petal";
        item.petalType = content().petal(basic).id;
        item.rarity = Rarity::Common;
        record.loadout[static_cast<std::size_t>(i)] = item;
    }
    giveToInventory(record, basic, Rarity::Common, kStartingSpares);
}

/// "Legendary Ladybug": the killer's tier and its type, each with only its
/// first character upper-cased.
///
/// Deliberately the mob's config ID rather than its display name, and
/// deliberately only one character of each word, because that is what the
/// reference's death card builds out of `{type, tier}` -- so a mob whose id is
/// `baby_ant` reads "Common Baby_ant" in both clients. A player killer reads
/// "Common Player", as it does there. An empty string means the killer is
/// unknown, which is what leaves the client on its own fallback wording.
std::string killerLabel(const World& world, Entity killer) {
    if (killer == NULL_ENTITY || !world.isAlive(killer)) return {};
    if (world.has<PlayerTag>(killer)) return "Common Player";
    const MobType* type = world.tryGet<MobType>(killer);
    if (type == nullptr) return {};
    std::string id = content().mob(type->configIndex).id;
    if (id.empty()) return {};
    id[0] = static_cast<char>(std::toupper(static_cast<unsigned char>(id[0])));
    return std::string(rarityLabel(type->rarity)) + " " + id;
}

/// How many rows of the global feed are kept. The browser build trims to the
/// last thousand on every write, so a feed that has been running for months is
/// still one screen of scrollback rather than a megabyte of the save file.
constexpr std::size_t kNotificationHistory = 1000;

/// A double the way JavaScript would print it: no trailing ".0" on a whole
/// number, which is what a star award always is in practice, and no exponent
/// for anything a code could plausibly be worth.
std::string numberText(double value) {
    if (value == std::floor(value) && std::fabs(value) < 1e15) {
        return std::to_string(static_cast<long long>(value));
    }
    char buffer[32];
    std::snprintf(buffer, sizeof buffer, "%g", value);
    return buffer;
}

/// The five type tags the browser stores, as the wire enum. Anything else is
/// Generic, which is also what an older notification with no type reads as.
net::NotificationKind notificationKind(const std::string& type) {
    if (type == "super_craft") return net::NotificationKind::SuperCraft;
    if (type == "unique_craft") return net::NotificationKind::UniqueCraft;
    if (type == "apex_craft") return net::NotificationKind::ApexCraft;
    if (type == "star_code") return net::NotificationKind::StarCode;
    return net::NotificationKind::Generic;
}

} // namespace

GameServer::GameServer() = default;
GameServer::~GameServer() = default;

bool GameServer::start(const ServerConfig& config, std::string& errorOut) {
    config_ = config;
    // The configured bot population, if the caller named one. Same field
    // `/admin set_bot_count` writes, so the two cannot disagree.
    botCountOverride_ = config.botCount;

    if (!loadContent(config.dataDir, errorOut)) return false;
    for (const std::string& warning : content().warnings()) {
        std::fprintf(stderr, "[content] %s\n", warning.c_str());
    }

    // A database that exists but will not parse is fatal at startup. Coming up
    // with an empty one would serve every returning player a blank account and,
    // worse, save that over the file they still had.
    if (!database_.load(config.databasePath, errorOut)) return false;

    rng_.reseed(config.worldSeed);
    // Derived from the same seed, so a world is still reproducible end to end,
    // but a stream of its own -- see botRng_.
    botRng_.reseed(config.worldSeed ^ 0x80757331B07B07ull);
    terrain_ = std::make_unique<Terrain>();
    // Every map the data directory stages, in manifest order: each one gets a
    // realm, a tile grid inside `terrain_` and an annotation layer inside
    // `worldMaps_`. A map that will not load IS fatal -- a teleporter aimed at
    // a missing map would drop players into a realm of solid wall -- while an
    // annotation layer that will not load is only reported.
    if (!worldMaps_.load(config.dataDir, terrain_.get(), errorOut)) return false;
    for (const std::string& warning : worldMaps_.warnings()) {
        std::fprintf(stderr, "[map] %s\n", warning.c_str());
    }
    // The broadphase was built before the maps were: its layers are sized to
    // the default world until it is told what shape each realm really is.
    grid_.sizeToRealms(*terrain_);

    movement_ = std::make_unique<MovementSystem>();
    // The AI caches queries against one world and wanders from its own
    // stream, so it takes both at construction rather than per call.
    mobAi_ = std::make_unique<MobAiSystem>(world_, config.worldSeed ^ 0x9E3779B9ull);
    petals_ = std::make_unique<PetalSystem>();
    combat_ = std::make_unique<CombatSystem>();
    spawning_ = std::make_unique<SpawnSystem>();
    modes_ = std::make_unique<ModeSpawner>();
    loot_ = std::make_unique<LootSystem>();
    if (!loot_->loadTables(content(), config.dataDir + "/mob_drops.json", errorOut)) return false;

    // Wire ids are unique across the whole server, so the id space belongs
    // here rather than to any one system. A system left unwired still
    // simulates -- its entities are simply not replicated, which is what a
    // headless test wants and what this must not be in production.
    petals_->allocateNetId = [this] { return netIds_.next(); };
    mobAi_->allocateNetId = [this] { return netIds_.next(); };
    spawning_->netIds = &netIds_;
    loot_->netIds = &netIds_;
    // One table, two readers: what a corpse pays XP for and what it reserves
    // its drops for must be the same answer. rebuildSquadIndex() refreshes it
    // once a tick; the pointer never moves.
    loot_->squads = &squadIndex_;
    combat_->squads = &squadIndex_;

    // The annotation layer is a read-only service, so the systems that need it
    // hold a pointer rather than being handed it per call. Left null they fall
    // back to behaviour with no map at all, which is what every unit test gets.
    // In production that would silently cost the spawn rectangles, the biome
    // tiers and every teleporter on the map, so it is wired here, once.
    spawning_->worldMaps = &worldMaps_;
    movement_->worldMaps = &worldMaps_;
    // A pad leads to another map, which is a realm change: a new tile grid on
    // the wire and a cleared view on the client. Only the connection layer can
    // do that, so the movement pass reports the jump and this carries it out.
    movement_->onTeleport = [this](Entity entity, Realm realm, Vec2 position) {
        moveEntityToRealm(entity, realm, position);
    };
    // Bots exist to populate the OVERWORLD, and their controller is written
    // against it: its flow field, its ray casts and its broadphase queries
    // all read that one map. A bot carried through a pad would steer around
    // walls it is not standing among, so pads simply do not take bots.
    movement_->takesTeleporters = [this](Entity entity) { return botForEntity(entity) == nullptr; };
    loot_->terrain = terrain_.get();

    // A revived flower has to be un-announced to its own client, and only the
    // connection layer can do that.
    petals_->onPlayerRevived = [this](Entity revived, Entity reviver) {
        onPlayerRevived(revived, reviver);
    };

    // The maze is a daily-seeded region of the world with its own walls. Its
    // geometry is a pure function of the day number, so the server picks the
    // day once at boot; every collision query inside the region then answers
    // against the same maze for the whole session.
    setActiveMazeDay(currentMazeDay());

    listener_.certPath = config.certPath;
    listener_.keyPath = config.keyPath;
    listener_.webRoot = config.webRoot;
    if (!listener_.start(config.port, errorOut)) return false;

    // Seeded before the first tick can set it: a message may be serviced ahead
    // of the first tick, and a deadline stamped from a zero clock is one that
    // has already passed.
    clockMillis_ = monotonicMillis();
    running_ = true;
    return true;
}

void GameServer::run() {
    nextTickMillis_ = monotonicMillis();
    clockMillis_ = nextTickMillis_;
    while (step()) {
    }
    shutdown();
}

void GameServer::shutdown() {
    // Flush account progress before exiting; an orderly shutdown must not cost
    // anyone their session.
    persistAll();
    listener_.stop();
}

std::size_t GameServer::persistAll() {
    std::size_t saved = 0;
    for (const auto& entry : sessions_) {
        if (!entry.second.playing()) continue;
        persistPlayer(entry.second);
        ++saved;
    }
    database_.save();
    return saved;
}

bool GameServer::step() {
    if (!running_.load()) return false;

    const double now = monotonicMillis();

    // Sleep in the network poll rather than in a bare sleep, so a packet
    // arriving mid-frame is picked up immediately instead of waiting out
    // the remainder of the tick.
    const int waitMillis = static_cast<int>(std::max(0.0, nextTickMillis_ - now));
    serviceNetwork(std::min(waitMillis, 5));

    const double tickNow = monotonicMillis();
    if (tickNow >= nextTickMillis_) {
        // Real elapsed time, clamped, then low-pass filtered -- see
        // smoothedDeltaSeconds_. Sampled before the tick so a slow tick
        // shows up in the NEXT step's delta, exactly as the reference's
        // performance.now() sample at the top of its interval does.
        double raw = lastTickWallMillis_ > 0
                         ? (tickNow - lastTickWallMillis_) / 1000.0
                         : net::kTickSeconds;
        lastTickWallMillis_ = tickNow;
        if (raw > kMaxDeltaSeconds) raw = kMaxDeltaSeconds;
        smoothedDeltaSeconds_ += (raw - smoothedDeltaSeconds_) * kDeltaSmoothing;

        // The REAL clock, not the scheduled slot. Every absolute deadline
        // in the world -- poison, slows, reloads, hit cooldowns, despawn --
        // is compared against this, so handing over a nominal time that
        // lags wall clock makes all of them fire late and then jump.
        const double tickStarted = monotonicMillis();
        tick(tickNow);
        const double tookMillis = monotonicMillis() - tickStarted;
        debugTickAccumMillis_ += tookMillis;
        if (tookMillis > debugTickMaxMillis_) debugTickMaxMillis_ = tookMillis;
        ++debugTickSamples_;

        nextTickMillis_ += net::kTickMillis;
        // A timer never queues up the fires it missed: a tick that overran
        // simply makes the next one land immediately, it does not run twice
        // to catch up. Replaying would advance the fixed-step mob half once
        // per replay while the dt-scaled half, which has just had its delta
        // reset to almost nothing, stood still.
        if (nextTickMillis_ < monotonicMillis()) nextTickMillis_ = monotonicMillis();

        if (tickNow >= nextDebugStatsMillis_) {
            broadcastDebugStats();
            nextDebugStatsMillis_ = tickNow + 1000.0;
        }
    }

    return running_.load();
}

void GameServer::serviceNetwork(int timeoutMillis) {
    listener_.poll(*this, timeoutMillis);
}

std::size_t GameServer::playerCount() const {
    std::size_t n = 0;
    for (const auto& entry : sessions_) {
        if (entry.second.playing()) ++n;
    }
    return n;
}

// ---------------------------------------------------------------------------
// Tick
// ---------------------------------------------------------------------------

void GameServer::tick(double nowMillis) {
    ++tick_;
    clockMillis_ = nowMillis;

    for (auto& entry : sessions_) refillAllowances(entry.second, nowMillis);

    // Invitations lapse on the server's own clock rather than on a timer per
    // invite, which is a timer that has to be cancelled when its target
    // disconnects. The ranking table is rebuilt beside it because a member's
    // BODY changes on every death: cached against the roster it would go stale
    // without the roster ever moving.
    squads_.expire(static_cast<std::int64_t>(nowMillis));
    rebuildSquadIndex();

    // Above the idle gate on purpose: a server with nobody left on it is
    // exactly the one a scheduled restart is usually waiting for, and an
    // install that finished while the last player left still has a restart to
    // schedule.
    serviceAutoUpdate();
    serviceScheduledRestart(nowMillis);

    // Housekeeping, ABOVE the idle gate: an account registered by somebody
    // sitting on the title screen is dirty in memory and would otherwise wait
    // for the next player to actually join before it reached the disk.
    if (nowMillis >= nextPersistMillis_) {
        nextPersistMillis_ = nowMillis + kPersistIntervalMillis;
        for (const auto& entry : sessions_) {
            if (entry.second.playing()) persistPlayer(entry.second);
        }
        database_.pruneExpiredSessions();
        database_.save();
    }

    // Bot population is maintained on every tick, INCLUDING the idle ones the
    // gate below returns out of -- that is where the reference calls it, and
    // it is what lets an empty server retire its bots after the grace period
    // rather than leaving them simulating for nobody.
    maintainBots(nowMillis);

    // Nobody in the world means nothing to simulate. The reference returns out
    // of its tick here and the whole world freezes: mobs stop wandering, nests
    // stop firing, lifetimes stop burning down and the unseen-despawn census
    // never runs. Without this gate an idle server quietly empties itself of
    // every mob it had and the first player back arrives on a bare map.
    //
    // The command buffer is still flushed: a disconnect between ticks queues a
    // destroy, and leaving it queued would keep the departed body in the world
    // and in every query until somebody joined.
    if (playerCount() == 0) {
        events_.clear();
        commands_.flush();
        listener_.flush();
        return;
    }

    // Record which input each player's movement is about to consume. The
    // snapshot reports this back, and it is the whole basis of reconciliation:
    // the client discards the predicted inputs at or below it and replays only
    // what is still outstanding. Left at zero, every client replays its entire
    // queue on top of an already-current position and drifts further each tick.
    Query<PlayerTag, PlayerInput> inputs{world_};
    inputs.each([](Entity, PlayerTag&, PlayerInput& input) {
        input.lastAppliedSequence = input.current.sequence;
    });

    runSystems(nowMillis, smoothedDeltaSeconds_);

    // BEFORE the reaper. A splitter gives one connection two bodies, and a
    // half that died this tick has to stop being part of the session before
    // the reaper meets it -- otherwise its owner is shown a death card for a
    // flower they are no longer steering. It is also where the split follows
    // the loadout: equipping the petal splits, taking it off merges.
    serviceSplitters(nowMillis);

    reapDead(nowMillis);
    commands_.flush();

    // The wire runs slower than the simulation and on its own clock: physics
    // and combat want 30 Hz, clients do not, and the per-recipient encode/cull/
    // delta pass is the largest thing in the tick that nothing simulated
    // depends on. Nothing about WHAT happens changes -- one-shot events are
    // queued for the frame either way -- only how often it is described.
    if (nowMillis >= nextSnapshotMillis_) {
        // Stepped from the deadline, not from now, so the send rate does not
        // slew with tick jitter; resynced when it falls a whole interval behind
        // rather than firing a burst of catch-up frames.
        nextSnapshotMillis_ += net::kSnapshotMillis;
        if (nextSnapshotMillis_ < nowMillis) nextSnapshotMillis_ = nowMillis + net::kSnapshotMillis;
        replicate(nowMillis);
        // One-shot events ride inside the snapshot here, where the reference
        // has its own per-tick outbox, so they are BANKED across the ticks that
        // send nothing rather than dropped: a hit that landed on a simulation
        // tick with no snapshot must still produce its number.
        events_.clear();
    }
    listener_.flush();
}

void GameServer::runSystems(double nowMillis, double dt) {
    // Order matters and is the tick's whole contract:
    //   bot intent -> players -> petals -> mob intent/movement -> projectiles
    //   -> combat -> spawning -> loot.
    // TypeScript closes the player movement window and runs the player's petal
    // pipeline before moveEnemies(), then advances projectiles after mobs.
    //
    // `dt` is the smoothed real step and drives the dt-SCALED half -- flowers,
    // petals, projectiles, fields. The mob half is a FIXED per-call step on
    // both sides (src/server.ts:1321 hands moveEnemies a hard 1/30), so it is
    // given net::kTickSeconds explicitly below rather than the tick's delta.

    // Bots decide before anything moves, which is where the reference samples
    // input: their decisions are made against the world as this tick found it
    // and are consumed by the very next stage, not one tick later.
    stepBots(nowMillis);

    // Modifiers before movement, as the reference schedules them (its
    // playerModifiers system sits in Phase.Input, ahead of playerMovement).
    // Folded only inside the petal phase below, a speed or size petal would not
    // reach movement until the tick after it was equipped.
    petals_->foldModifiers(world_, content());

    movement_->runPlayerPhase(world_, *terrain_, nowMillis, dt);
    petals_->run(world_, content(), nowMillis, dt, commands_, terrain_.get(), &events_);

    // Mob targeting must see the flowers' newly committed positions. Refresh
    // both the LOD list and broadphase after player movement instead of asking
    // AI to make this tick's decision from last tick's coordinates.
    //
    // Two lists, because two questions are being asked. EVERY flower is an
    // observer for the mob LOD and for the spawner's wake-up pass, bots
    // included: a bot fighting a mob is something worth simulating properly,
    // and a bot standing in a band is something that band has to be awake for.
    // A bot in that list can no longer inflate anything -- a band holds the
    // population its own area buys whether anyone is there or not, and being
    // looked at only decides how much of it is currently an entity.
    //
    // The HUMAN list is what the arena and the maze are filled for: those are
    // generated realms with no bands, ModeSpawner stocks each one whole while
    // somebody is in it, and a bot has no business keeping one populated.
    activePlayers_.clear();
    Query<PlayerTag, Transform> players{world_};
    players.each([&](Entity, PlayerTag&, Transform& transform) {
        activePlayers_.push_back({transform.position, transform.realm});
    });
    humanPlayers_.clear();
    for (const auto& entry : sessions_) {
        if (!entry.second.playing()) continue;
        if (const Transform* transform = world_.tryGet<Transform>(entry.second.entity)) {
            humanPlayers_.push_back({transform->position, transform->realm});
        }
    }
    grid_.clear();
    Query<Transform, Body> afterPlayers{world_};
    afterPlayers.each([&](Entity e, Transform& transform, Body& body) {
        grid_.insert(e, transform.realm, transform.position, body.radius);
    });

    // The reference server resolves flower bodies and the petal ring inside
    // the player pipeline, before moveEnemies(). Keep that temporal boundary:
    // a mob cannot escape a petal it was already touching by moving first.
    combat_->beginTick(world_, nowMillis, dt, events_);
    combat_->runContactPhase(world_, grid_, content(), nowMillis);

    mobAi_->run(world_, *terrain_, grid_, activePlayers_, nowMillis, net::kTickSeconds, commands_);
    movement_->runWorldPhase(world_, *terrain_, nowMillis, net::kTickSeconds);
    // AFTER the mobs have moved, for the reason a flower's ring is placed
    // after its own movement: a seat is a rigid offset from the body, and a
    // ring carried before the body moves trails it by a tick.
    mobAi_->tickPetalRings(world_, commands_);

    // Combat exact-tests current transforms, but its candidate set comes from
    // this grid. Rebuild after mob/projectile flight so a cell crossing cannot
    // make a real overlap invisible for one tick.
    grid_.clear();
    Query<Transform, Body> afterMovement{world_};
    afterMovement.each([&](Entity e, Transform& transform, Body& body) {
        grid_.insert(e, transform.realm, transform.position, body.radius);
    });
    combat_->runWorldPhase(world_, grid_, content(), nowMillis, dt);
    spawning_->run(world_, *terrain_, content(), activePlayers_, rng_, nowMillis,
                   net::kTickSeconds, commands_);
    // The arena and the maze are filled whole rather than by viewport, and only
    // while someone is in them.
    modes_->run(world_, *terrain_, content(), *spawning_, grid_, humanPlayers_, rng_, nowMillis);
    loot_->run(world_, grid_, content(), rng_, nowMillis, dt, commands_, events_);

    // A pickup is a world event; owning it is an account fact. The loot system
    // deliberately knows nothing about the database, so the hand-off is here.
    bankPickups();
    // Same reasoning for kills: combat marks the corpse, the account keeps the
    // tally. Runs before the reaper, while MobType is still readable.
    bankKills();

    // The spawner has no view of the socket list, so it queues the bosses it
    // admitted rather than announcing them.
    announceBossSpawns();
}

void GameServer::announceBossSpawns() {
    for (const SpawnSystem::BossSpawn& boss : spawning_->bossSpawns) {
        // The bots hear about it too, from the same event and in the same
        // breath. Every path that can put a boss in the world queues one of
        // these -- a band stocking itself in a corner nobody has visited, a
        // nest's escort, the arena, an operator's console -- so there is one
        // place a boss becomes news and no way to add a spawn path that
        // produces one the server says nothing about.
        noteBossSighting(boss.entity, clockMillis_);

        // Underscores read as spaces in the reference's wording, so
        // `soldier_ant` announces itself as "soldier ant".
        std::string name = content().mob(boss.mobIndex).id;
        for (char& c : name) {
            if (c == '_') c = ' ';
        }
        // Only meaningful for a boss on the overworld: `section` is that map's
        // 3x3 grid, and another map's coordinates read as a section number that
        // means nothing. See `here` below.
        const int section = sectionAt(boss.position);
        const std::string tier = rarityLabel(boss.rarity);
        // Wrapped in the tier's own colour, as the reference server wraps it.
        // The client parses the markup; sending the announcement bare left it
        // the one boss line in the game with no tier colour on it.
        char colorAttribute[32];
        std::snprintf(colorAttribute, sizeof colorAttribute, "#%06x",
                      rarityColor(boss.rarity));

        for (auto& entry : sessions_) {
            Session& session = entry.second;
            if (!session.playing()) continue;
            net::Connection* connection = listener_.find(session.connection);
            if (connection == nullptr) continue;
            // Personalised: a player standing in the boss's own section is told
            // it spawned, everyone else that it spawned "somewhere". A band on
            // ANY staged world map can fill with supers now -- difficulty is
            // what makes bosses -- so the boss's OWN realm has to match before
            // its position means anything: two maps are two coordinate spaces,
            // and (9000, 9000) on one is not near (9000, 9000) on the other.
            const Transform* transform = world_.tryGet<Transform>(session.entity);
            const bool here = transform != nullptr && transform->realm == boss.realm &&
                              transform->realm == Realm::Overworld &&
                              sectionAt(transform->position) == section;
            sendChatTo(*connection, net::ChatChannel::System, "",
                       std::string("<b style=\"color: ") + colorAttribute + ";\">A " + tier +
                           " " + name + " has spawned" + (here ? "" : " somewhere") + "!</b>");
        }
    }
    spawning_->bossSpawns.clear();
}

void GameServer::bankPickups() {
    for (const LootSystem::Pickup& pickup : loot_->pickups()) {
        Session* session = sessionForEntity(pickup.player);
        if (!session || session->userId.empty()) continue;
        if (pickup.petalIndex >= content().petalCount()) continue;

        // Into the bag the body is playing with: an arena pickup is the run's,
        // not the account's, until the run ends.
        giveToInventory(liveRecord(*session), pickup.petalIndex, pickup.rarity, 1);
        database_.markDirty();

        if (net::Connection* connection = listener_.find(session->connection)) {
            sendProfile(*session, *connection);
        }
    }
}

void GameServer::reapDead(double nowMillis) {
    // Death is a component, not a destroy, so everything later in the SAME tick
    // still sees the entity -- a mob that dies during combat must still be
    // there for the loot system to read its contributor list. The actual
    // destroy happens here, once, at the end.
    Query<Dead> dead{world_};
    std::vector<Entity> doomed;
    dead.collect(doomed);
    for (const Entity e : doomed) {
        const bool isPlayer = world_.has<PlayerTag>(e);
        Session* session = isPlayer ? sessionForEntity(e) : nullptr;
        // A bot has no session, so the roster is what tells a bot's body apart
        // from a flower whose connection simply went away.
        Bot* bot = isPlayer && session == nullptr ? botForEntity(e) : nullptr;

        // A player's corpse KEEPS its Dead tag, which is what puts the dead
        // face and the dead state on the wire and what makes every system step
        // over the body. That means this loop meets the same corpse on every
        // later tick, so everything below has to happen exactly once.
        if (isPlayer) {
            if (session == nullptr && bot == nullptr) {
                // Nobody is watching through this body and nothing owns it. It
                // leaves no corpse and no death notice, and its ring goes with
                // it: a petal outliving its owner orbits a point in space
                // forever. So do its pets: a splitter half killed in combat is
                // reaped on the tick it died, AFTER the ring pass, so the pass
                // that recalls a downed flower's summons never sees it down.
                destroyBody(e);
                continue;
            }
            if (session != nullptr ? session->deathReported : bot->deathAnnounced) continue;
        }

        if (world_.has<NetId>(e)) {
            const Transform* transform = world_.tryGet<Transform>(e);
            events_.killed(world_.get<NetId>(e).value, transform ? transform->position : Vec2{},
                           transform ? transform->realm : Realm::Overworld);
        }

        if (isPlayer) {
            if (session != nullptr) {
                session->deathReported = true;
                // In the ring a death hands the run over to the killer before
                // anything is written down.
                if (session->arena) settleArenaDeath(*session, world_.get<Dead>(e).killer);
                persistPlayer(*session);
                if (net::Connection* connection = listener_.find(session->connection)) {
                    ByteWriter w;
                    w.u8(static_cast<std::uint8_t>(net::ServerMessage::Died));
                    w.str(killerLabel(world_, world_.get<Dead>(e).killer));
                    w.u32(0);
                    w.u32(tick_);
                    connection->send(w);
                }
            } else {
                // A bot leaves a corpse too, which is not tidiness: bots carry
                // yggdrasil for each other and actively path to each other's
                // bodies, and a body destroyed on the tick it died is one
                // nothing can ever revive. maintainBots owns the replacement
                // and takes this body away when it builds the new one.
                bot->deathAnnounced = true;
            }
            if (Health* health = world_.tryGet<Health>(e)) {
                health->current = 0;
            }
            // A corpse lies where it fell, at whatever angle it fell at. The
            // roll is the server's so every client sees the same body.
            if (Transform* transform = world_.tryGet<Transform>(e)) {
                transform->angle = rng_.angle();
            }
            continue;
        }
        commands_.destroy(e);
    }
    (void)nowMillis;
}

void GameServer::replicate(double nowMillis) {
    Replicator::Frame frame;
    frame.tick = tick_;
    frame.snapshotIndex = ++snapshotIndex_;
    frame.nowMillis = nowMillis;
    frame.events = &events_;

    // Reused across recipients rather than allocated per session: it is at
    // most three entities and almost always none.
    std::vector<Entity> squadBodies;
    for (auto& entry : sessions_) {
        Session& session = entry.second;
        if (!session.playing()) continue;
        net::Connection* connection = listener_.find(session.connection);
        if (!connection) continue;

        collectSquadBodies(session, squadBodies);
        frame.alwaysVisible = squadBodies.empty() ? nullptr : &squadBodies;

        scratch_.clear();
        replicator_.build(world_, session.entity, views_[session.connection], frame, scratch_);
        if (!scratch_.empty()) connection->send(scratch_);
    }
}

// ---------------------------------------------------------------------------
// Connections
// ---------------------------------------------------------------------------

Session* GameServer::sessionFor(net::ConnectionId id) {
    auto it = sessions_.find(id);
    return it == sessions_.end() ? nullptr : &it->second;
}

Session* GameServer::sessionForEntity(Entity e) {
    for (auto& entry : sessions_) {
        // EITHER half. A splitter's parked body is still this person's -- a
        // drop it walks over, a kill its ring lands and a pad it is standing
        // on all belong to the same account -- and a lookup that only knew
        // about the steered one would credit them to nobody.
        if (entry.second.owns(e)) return &entry.second;
    }
    return nullptr;
}

void GameServer::onConnect(net::Connection& connection) {
    Session session;
    session.connection = connection.id();
    session.connectedAtMillis = monotonicMillis();
    session.lastHeardMillis = session.connectedAtMillis;
    sessions_[connection.id()] = std::move(session);
    views_[connection.id()] = ClientView{};
}

void GameServer::onDisconnect(net::Connection& connection, const std::string&) {
    if (Session* session = sessionFor(connection.id())) {
        // Before the body is destroyed, so the line the squad is told still
        // knows what this flower was called.
        departSquad(*session, nullptr, squadDisplayName(squadIdOf(*session)));
        if (session->playing()) {
            persistPlayer(*session);
            despawnPlayer(*session, false);
        }
    }
    revokeTempAdmin(connection.id());
    sessions_.erase(connection.id());
    views_.erase(connection.id());
}

void GameServer::onMessage(net::Connection& connection, ByteReader& reader) {
    Session* session = sessionFor(connection.id());
    if (!session) return;
    session->lastHeardMillis = monotonicMillis();

    const auto id = static_cast<net::ClientMessage>(reader.u8());

    // Nothing but the handshake is accepted until the protocol has been agreed.
    // A client that skips it cannot reach any game logic at all.
    if (session->stage == SessionStage::Greeting && id != net::ClientMessage::Hello) {
        connection.closeGracefully();
        return;
    }

    switch (id) {
        case net::ClientMessage::Hello:         handleHello(*session, connection, reader); break;
        case net::ClientMessage::Register:      handleRegister(*session, connection, reader); break;
        case net::ClientMessage::Login:         handleLogin(*session, connection, reader); break;
        case net::ClientMessage::ResumeSession: handleResume(*session, connection, reader); break;
        case net::ClientMessage::ChangePassword:
            handleChangePassword(*session, connection, reader);
            break;
        case net::ClientMessage::JoinGame:      handleJoin(*session, connection, reader); break;
        case net::ClientMessage::LeaveGame:     handleLeave(*session, connection); break;
        case net::ClientMessage::Input:         handleInput(*session, reader); break;
        case net::ClientMessage::Chat:          handleChat(*session, connection, reader); break;
        case net::ClientMessage::SetLoadout:    handleSetLoadout(*session, reader); break;
        case net::ClientMessage::SwapLoadout:   handleSwapLoadout(*session, reader); break;
        case net::ClientMessage::UsePetal:      handleUsePetal(*session, reader); break;
        case net::ClientMessage::Craft:         handleCraft(*session, connection, reader); break;
        case net::ClientMessage::Respawn:       handleRespawn(*session); break;
        case net::ClientMessage::Ping:          handlePing(connection, reader); break;
        case net::ClientMessage::UpgradeSkill:  handleUpgradeSkill(*session, connection, reader); break;
        case net::ClientMessage::ResetSkills:   handleResetSkills(*session, connection); break;
        case net::ClientMessage::BuyPetal:      handleBuyPetal(*session, connection, reader); break;
        case net::ClientMessage::RedeemCode:    handleRedeemCode(*session, connection, reader); break;
        case net::ClientMessage::SetSkin:       handleSetSkin(*session, connection, reader); break;
        case net::ClientMessage::RequestLeaderboard: handleLeaderboard(*session, connection); break;
        case net::ClientMessage::RequestNotifications: handleNotifications(connection, reader); break;
        case net::ClientMessage::GuildCreate:   handleGuildCreate(*session, connection, reader); break;
        case net::ClientMessage::GuildInvite:   handleGuildInvite(*session, connection, reader); break;
        case net::ClientMessage::GuildAccept:   handleGuildAccept(*session, connection); break;
        case net::ClientMessage::GuildDecline:  handleGuildDecline(*session, connection); break;
        case net::ClientMessage::GuildKick:     handleGuildKick(*session, connection, reader); break;
        case net::ClientMessage::GuildLeave:    handleGuildLeave(*session, connection); break;
        case net::ClientMessage::GuildSquadAll: handleGuildSquadAll(*session, connection); break;
        case net::ClientMessage::GuildInviteToSquad:
            handleGuildInviteToSquad(*session, connection, reader);
            break;
        case net::ClientMessage::PublishSkin:   handlePublishSkin(*session, connection, reader); break;
        case net::ClientMessage::EquipSkin:     handleEquipSkin(*session, connection, reader); break;
        case net::ClientMessage::DeleteSkin:    handleDeleteSkin(*session, connection, reader); break;
        case net::ClientMessage::Logout:        handleLogout(*session); break;
        default:
            break;
    }
}

void GameServer::handleHello(Session& session, net::Connection& connection, ByteReader& reader) {
    const std::uint16_t version = reader.u16();
    const std::uint32_t clientContent = reader.u32();
    if (!reader.ok()) { connection.closeGracefully(); return; }

    ByteWriter w;
    w.u8(static_cast<std::uint8_t>(net::ServerMessage::Welcome));
    w.u16(net::kProtocolVersion);

    if (version != net::kProtocolVersion) {
        w.boolean(false);
        w.str("This client speaks protocol " + std::to_string(version) + "; the server speaks " +
              std::to_string(net::kProtocolVersion) + ". Please update.");
        connection.send(w);
        connection.closeGracefully();
        return;
    }
    if (clientContent != content().contentHash()) {
        // Mob and petal stats are read from JSON by both sides. If the two read
        // different files, every number the client shows is quietly wrong --
        // far better to say so at connect time.
        w.boolean(false);
        w.str("Your game content does not match the server's. Please update.");
        connection.send(w);
        connection.closeGracefully();
        return;
    }

    w.boolean(true);
    w.str("");
    connection.send(w);
    session.stage = SessionStage::Anonymous;
}

void GameServer::sendAuthResult(net::Connection& connection, net::AuthStatus status,
                                const std::string& token, const std::string& username,
                                const std::string& reason) {
    ByteWriter w;
    w.u8(static_cast<std::uint8_t>(net::ServerMessage::AuthResult));
    w.u8(static_cast<std::uint8_t>(status));
    w.str(token);
    w.str(username);
    w.str(reason);
    connection.send(w);
}

void GameServer::handleRegister(Session& session, net::Connection& connection, ByteReader& reader) {
    const std::string username = reader.str();
    const std::string password = reader.str();
    if (!reader.ok()) return;

    if (!spend(session.loginAttemptsAllowed)) {
        sendAuthResult(connection, net::AuthStatus::RateLimited, "", "", "Too many attempts. Wait a moment.");
        return;
    }

    std::string reason;
    if (!validUsername(username, reason)) {
        sendAuthResult(connection, net::AuthStatus::UsernameInvalid, "", "", reason);
        return;
    }
    if (!validPassword(password, reason)) {
        sendAuthResult(connection, net::AuthStatus::PasswordInvalid, "", "", reason);
        return;
    }

    // Below the format checks, so mistyping a password does not cost one of the
    // three accounts an address gets: those checks are pure string work and are
    // already bounded by the per-session budget above. Above the bcrypt hash and
    // the database write, which are the work an unlimited registration endpoint
    // hands an attacker.
    //
    // That session budget bounds one SOCKET; it does not bound one client, which
    // can hang up and dial again for a fresh allowance. These limits are keyed
    // on the address instead, and outlive any one connection.
    const std::string address = addressKey(connection.peer());
    const std::string addressHash = database_.accountAddressHash(address);
    const LimitVerdict verdict = accountLimits_.spendRegistration(
        address,
        [&] { return database_.countAccountsCreatedBy(addressHash, kRegisterDailyWindowMillis); },
        monotonicMillis());
    if (!verdict.allowed) {
        const std::string line =
            accountLimits_.refusalLogLine(address, verdict.scope, monotonicMillis());
        if (!line.empty()) std::printf("%s\n", line.c_str());
        sendAuthResult(connection, net::AuthStatus::RateLimited, "", "", verdict.message);
        return;
    }

    const CreateResult result = database_.createUser(username, password, addressHash);
    if (!result.ok() || !result.account) {
        sendAuthResult(connection, net::AuthStatus::UsernameTaken, "", "", result.reason);
        return;
    }

    session.userId = result.account->id;
    session.username = result.account->username;
    session.token = database_.createSession(session.userId, session.username);

    grantStarterKit(database_.progress(session.userId));
    database_.markDirty();
    session.stage = SessionStage::Authenticated;
    sendAuthResult(connection, net::AuthStatus::Ok, session.token, session.username, "");
    sendDailyStreak(session, connection);
    sendProfile(session, connection);
    sendSkinCatalog(session, connection);
    sendGuildState(session, connection);
}

void GameServer::handleLogin(Session& session, net::Connection& connection, ByteReader& reader) {
    const std::string username = reader.str();
    const std::string password = reader.str();
    if (!reader.ok()) return;

    if (!spend(session.loginAttemptsAllowed)) {
        sendAuthResult(connection, net::AuthStatus::RateLimited, "", "", "Too many attempts. Wait a moment.");
        return;
    }
    // Same reasoning as handleRegister: a reconnect resets the session budget,
    // and every attempt costs this server a bcrypt verify.
    const std::string address = addressKey(connection.peer());
    const LimitVerdict verdict = accountLimits_.spendLoginAttempt(address, monotonicMillis());
    if (!verdict.allowed) {
        sendAuthResult(connection, net::AuthStatus::RateLimited, "", "", verdict.message);
        return;
    }

    if (!database_.verifyPassword(username, password)) {
        // Deliberately the same answer for a wrong password and an unknown
        // account: distinguishing them tells an attacker which names exist.
        sendAuthResult(connection, net::AuthStatus::BadCredentials, "", "",
                       "Invalid username or password");
        return;
    }

    const Account* account = database_.findUser(username);
    if (!account) {
        sendAuthResult(connection, net::AuthStatus::ServerError, "", "", "Account could not be read.");
        return;
    }
    // A player who signed in is not what the limit is for.
    accountLimits_.refundLoginAttempt(address);

    session.userId = account->id;
    session.username = account->username;
    session.admin = account->admin;
    session.token = database_.createSession(account->id, account->username);
    session.stage = SessionStage::Authenticated;
    sendAuthResult(connection, net::AuthStatus::Ok, session.token, account->username, "");
    sendDailyStreak(session, connection);
    sendProfile(session, connection);
    sendSkinCatalog(session, connection);
    sendGuildState(session, connection);
}

void GameServer::handleResume(Session& session, net::Connection& connection, ByteReader& reader) {
    const std::string token = reader.str();
    if (!reader.ok()) return;

    const Database::Session* record = database_.resolveSession(token);
    if (!record) {
        sendAuthResult(connection, net::AuthStatus::SessionExpired, "", "", "Please log in again.");
        return;
    }

    session.userId = record->userId;
    session.username = record->username;
    session.token = token;
    session.stage = SessionStage::Authenticated;
    if (const Account* account = database_.findUser(record->username)) session.admin = account->admin;
    sendAuthResult(connection, net::AuthStatus::Ok, token, record->username, "");
    sendDailyStreak(session, connection);
    sendProfile(session, connection);
    sendSkinCatalog(session, connection);
    sendGuildState(session, connection);
}

void GameServer::sendChangePasswordResult(net::Connection& connection, bool ok,
                                          const std::string& token, const std::string& reason) {
    ByteWriter w;
    w.u8(static_cast<std::uint8_t>(net::ServerMessage::ChangePasswordResult));
    w.boolean(ok);
    w.str(token);
    w.str(reason);
    connection.send(w);
}

void GameServer::handleChangePassword(Session& session, net::Connection& connection,
                                      ByteReader& reader) {
    const std::string current = reader.str();
    const std::string next = reader.str();
    if (!reader.ok()) return;

    // WHOSE password this is comes from the session and from nowhere else. A
    // username on the wire would make this an endpoint for changing another
    // account's password, and an anonymous socket has no account to name.
    if (!session.authenticated() || session.username.empty()) {
        sendChangePasswordResult(connection, false, "", "You are not signed in.");
        return;
    }

    // Held to the login budgets, both of them: this costs a bcrypt verify and
    // then a bcrypt hash, so it is strictly dearer than a login, and a wrong
    // `current` is a password guess like any other -- against an account whose
    // socket may have been left open on a shared machine. The per-session
    // budget bounds this connection; the per-address one outlives a reconnect.
    if (!spend(session.loginAttemptsAllowed)) {
        sendChangePasswordResult(connection, false, "", "Too many attempts. Wait a moment.");
        return;
    }
    const std::string address = addressKey(connection.peer());
    const LimitVerdict verdict = accountLimits_.spendLoginAttempt(address, monotonicMillis());
    if (!verdict.allowed) {
        sendChangePasswordResult(connection, false, "", verdict.message);
        return;
    }

    if (!database_.verifyPassword(session.username, current)) {
        sendChangePasswordResult(connection, false, "", "Your current password is not correct.");
        return;
    }
    // Producing the current password is proof of the account, not a guess at
    // it, so it does not spend from the budget -- the same reason a successful
    // login refunds its attempt.
    accountLimits_.refundLoginAttempt(address);

    if (current == next) {
        // Refused rather than quietly accepted: the sessions below would be
        // revoked and the token reissued for a change that did not happen, so
        // the player would be signed out elsewhere for nothing.
        sendChangePasswordResult(connection, false, "", "That is already your password.");
        return;
    }

    std::string reason;
    if (!database_.setPassword(session.username, next, reason)) {
        sendChangePasswordResult(connection, false, "", reason);
        return;
    }

    // Every token the account had dies with the old password. That is most of
    // what changing one is for: a session somebody else is holding would
    // otherwise outlive it by up to thirty days, and a stolen token is the
    // case a player changes their password over. This connection's own token
    // is among them, so it is replaced in the same breath -- the socket stays
    // authenticated either way, because the stage is in memory rather than in
    // the token, but the client has to be holding a live one to resume with.
    database_.revokeSessionsForUser(session.username);
    session.token = database_.createSession(session.userId, session.username);

    // Rate-limited rather than immediate, and not left to the thirty-second
    // persist either: a player who changes a password and closes the game must
    // not find the old one still working, and a whole-file write per request
    // would be a stall anyone could ask for.
    database_.maybeSave(monotonicMillis());

    sendChangePasswordResult(connection, true, session.token, "");
}

void GameServer::handleLogout(Session& session) {
    // An anonymous socket has no account to log out of.
    if (!session.authenticated()) return;
    const std::string userId = session.userId;

    // Every token the account holds, not only this connection's. A logout
    // that left the others alive would leave a copy on a shared machine, or
    // one somebody lifted, good for up to thirty more days -- and "log out"
    // is the button a player reaches for in exactly that situation.
    database_.revokeSessionsForUser(session.username);
    signOut(session);

    // The tokens were only half of it: a connection that already resumed one
    // is authenticated in memory, not by the token, and would play on as the
    // account until it dropped. Each is signed out here and told so with the
    // answer a dead token gets, which is the one its client already knows
    // means "back to the login form".
    for (auto& [id, other] : sessions_) {
        if (id == session.connection || !other.authenticated() || other.userId != userId) continue;
        signOut(other);
        if (net::Connection* connection = listener_.find(id)) {
            sendAuthResult(*connection, net::AuthStatus::SessionExpired, "", "",
                           "This account was logged out elsewhere.");
        }
    }

    // Same reason as a password change: a revocation still waiting for the
    // thirty-second persist is undone by a crash inside that window.
    database_.maybeSave(monotonicMillis());
}

void GameServer::signOut(Session& session) {
    // A body in the world belongs to the account that is going away, so it
    // comes off first -- and with its progress saved, because a logout is a
    // deliberate exit, not a drop. Left alone it would be an orphan: a flower
    // nobody can steer and no account can persist.
    if (session.playing()) {
        persistPlayer(session);
        despawnPlayer(session, false);
    }
    revokeTempAdmin(session.connection);
    session.token.clear();
    session.userId.clear();
    // Both of these gate later messages -- `admin` unlocks the console
    // commands, `username` is who the chat and the guild take this connection
    // for -- so an anonymous session must not keep either.
    session.username.clear();
    session.admin = false;
    session.displayName.clear();
    // Last: despawnPlayer() puts the stage back to Authenticated, and this is
    // what the socket actually is now.
    session.stage = SessionStage::Anonymous;
}

void GameServer::sendProfile(Session& session, net::Connection& connection) {
    // The bag and ring the body is playing with (the arena run's, in the
    // ring), and the progression track it is on (the maze's, in the maze) --
    // so the panels show what the flower actually has and the talent menu
    // spends the points the body actually earned.
    const PlayerRecord& record = liveRecord(session);
    const bool onMazeTrack = session.playing() && session.realm == Realm::Maze;
    const double trackXp = onMazeTrack ? record.mazeTotalXp : record.totalXp;
    const SkillSet& skills = onMazeTrack ? record.mazeSkills : record.skills;

    ByteWriter w;
    w.u8(static_cast<std::uint8_t>(net::ServerMessage::Profile));
    w.str(session.username);
    w.f64(trackXp);
    w.u16(static_cast<std::uint16_t>(levelFromTotalXp(trackXp).level));
    w.f64(std::max(0.0, record.stars));

    // The inventory is a sparse dictionary of rarity -> item name -> count.
    // Anything whose name this build does not know (an item from a newer
    // server, or a non-petal) is skipped for the wire but left untouched in
    // the record, so it survives the next save.
    const std::size_t stackCountAt = w.reserveU16();
    std::uint16_t stackCount = 0;
    for (const std::string& rarityName : record.inventory.keys()) {
        const Rarity rarity = parseRarity(rarityName);
        const Json& byType = record.inventory[rarityName];
        for (const std::string& key : byType.keys()) {
            const std::uint32_t count = static_cast<std::uint32_t>(std::max(0, byType[key].asInt()));
            if (count == 0) continue;
            const std::uint16_t index = petalIndexFromInventoryKey(key);
            if (index == kInvalidIndex) continue;
            w.u16(index);
            w.u8(static_cast<std::uint8_t>(rarity));
            w.u32(count);
            ++stackCount;
        }
    }
    w.patchU16(stackCountAt, stackCount);

    // The ring the flower is actually wearing, which in the maze is the
    // account's shifted down a tier: a bar advertising the rarity the account
    // owns while the body swings one below it is a bar that lies.
    const Realm realm = session.playing() ? session.realm : Realm::Overworld;
    w.u8(static_cast<std::uint8_t>(kLoadoutSlots));
    for (std::size_t i = 0; i < kLoadoutSlots; ++i) {
        const WornSlot worn = wornSlot(record, i, realm);
        w.u16(worn.petalIndex);
        w.u8(static_cast<std::uint8_t>(worn.rarity));
    }

    w.u32(record.renderFlags);

    // The talent tree. Only branches that have been bought are sent; the
    // balance is derived on both sides from the level, so it is not on the
    // wire at all and cannot arrive disagreeing with the tiers beside it.
    const std::size_t skillCountAt = w.reserveU16();
    std::uint16_t skillCount = 0;
    for (int i = 0; i < kSkillCount; ++i) {
        const int tier = skills.tier[static_cast<std::size_t>(i)];
        if (tier < 0) continue;
        w.u8(static_cast<std::uint8_t>(i));
        w.u8(static_cast<std::uint8_t>(tier));
        ++skillCount;
    }
    w.patchU16(skillCountAt, skillCount);

    // The mob-kill ledger, for the gallery. Mob ids this build does not know
    // are skipped for the wire and left in the record, exactly as the
    // inventory is: a gallery cell is worth less than an account's history.
    const std::size_t killCountAt = w.reserveU16();
    std::uint16_t killCount = 0;
    for (const std::string& mobId : record.mobKills.keys()) {
        const std::uint16_t index = content().mobIndex(mobId);
        if (index == kInvalidIndex) continue;
        const Json& byTier = record.mobKills[mobId];
        if (!byTier.isObject()) continue;
        for (const std::string& tier : byTier.keys()) {
            const std::uint32_t count = static_cast<std::uint32_t>(std::max(0, byTier[tier].asInt()));
            if (count == 0) continue;
            w.u16(index);
            w.u8(static_cast<std::uint8_t>(parseRarity(tier)));
            w.u32(count);
            ++killCount;
        }
    }
    w.patchU16(killCountAt, killCount);

    connection.send(w);
}

void GameServer::sendDailyStreak(Session& session, net::Connection& connection) {
    const DailyStreakResult streak = database_.processDailyStreak(session.userId);

    ByteWriter w;
    w.u8(static_cast<std::uint8_t>(net::ServerMessage::DailyStreak));
    w.u16(static_cast<std::uint16_t>(std::max(0, streak.streak)));
    w.boolean(streak.newDay);
    w.u16(static_cast<std::uint16_t>(std::max(0, streak.starsAwarded)));
    w.i64(streak.nextClaimAtMillis);
    w.i64(streak.streakExpiresAtMillis);
    connection.send(w);
}

void GameServer::sendNotice(net::Connection& connection, net::NoticeSeverity severity,
                            const std::string& text) {
    ByteWriter w;
    w.u8(static_cast<std::uint8_t>(net::ServerMessage::Notice));
    w.u8(static_cast<std::uint8_t>(severity));
    w.str(text);
    connection.send(w);
}

void GameServer::sendShopResult(net::Connection& connection, net::ShopResultKind kind, bool ok,
                                double stars, const std::string& message) {
    ByteWriter w;
    w.u8(static_cast<std::uint8_t>(net::ServerMessage::ShopResult));
    w.u8(static_cast<std::uint8_t>(kind));
    w.boolean(ok);
    w.f64(std::max(0.0, stars));
    w.str(message);
    connection.send(w);
}

void GameServer::broadcastChat(net::ChatChannel channel, const std::string& author,
                               const std::string& text, std::uint32_t speakerNetId) {
    ByteWriter w;
    w.u8(static_cast<std::uint8_t>(net::ServerMessage::Chat));
    w.u8(static_cast<std::uint8_t>(channel));
    w.str(author);
    w.str(text);
    w.u32(speakerNetId);
    listener_.each([&](net::Connection& connection) {
        const Session* session = sessionFor(connection.id());
        if (session && session->authenticated()) connection.send(w);
    });
}

void GameServer::handleJoin(Session& session, net::Connection& connection, ByteReader& reader) {
    const double width = reader.u16();
    const double height = reader.u16();
    const std::string where = reader.str();
    const std::string name = reader.str();
    if (!reader.ok()) return;
    if (!session.authenticated()) return;
    if (session.playing()) return;

    // The nameplate, not the account. Kept on the session so a respawn keeps
    // the name the player typed rather than reverting to their login.
    session.displayName = sanitizePlayerName(name);

    // Remembered on the session so a respawn returns to the spawn point the
    // player chose, rather than quietly sending them back to the beginner
    // ground. A choice no staged map defines is dropped here, once, with a
    // notice -- rather than silently every time they die.
    session.spawnChoice.clear();
    if (where == kArenaSpawnChoice || where == kMazeSpawnChoice) {
        // The two destinations that are not on any map at all: each is a realm
        // of its own (realm.h), generated rather than authored, so there is no
        // spawn rectangle to look up.
        session.spawnChoice = where;
    } else if (!where.empty() && where != "default") {
        if (worldMaps_.choice(where) != nullptr) {
            session.spawnChoice = where;
        } else if (worldMaps_.door(where) != nullptr) {
            // A door that exists but is not offered: a map marks it
            // `pickable: false`, and it is reached through a pad rather than
            // from the picker. An admin may still name it -- that is how a
            // screenshot rig reaches one -- but anyone else starts where the
            // picker would have let them.
            if (session.admin) {
                session.spawnChoice = where;
            } else {
                sendNotice(connection, net::NoticeSeverity::Warning,
                           "That door is reached from its biome; starting at the default.");
            }
        } else {
            sendNotice(connection, net::NoticeSeverity::Warning,
                       "That spawn point is not on this server; starting at the default.");
        }
    }

    if (playerCount() >= config_.maxPlayers) {
        sendNotice(connection, net::NoticeSeverity::Bad, "The server is full.");
        return;
    }

    const Entity entity = spawnPlayer(session);
    if (entity == NULL_ENTITY) {
        sendNotice(connection, net::NoticeSeverity::Bad, "Could not find a spawn point.");
        return;
    }

    PlayerLocation& location = world_.get<PlayerLocation>(entity);
    location.viewport = {clamp(width, 320.0, kMaxViewportAxis),
                         clamp(height, 240.0, kMaxViewportAxis)};

    views_[session.connection].reset();

    ByteWriter w;
    w.u8(static_cast<std::uint8_t>(net::ServerMessage::JoinAccepted));
    w.u32(world_.get<NetId>(entity).value);
    w.position(world_.get<Transform>(entity).position);
    w.u32(tick_);
    // Which maze the server is playing: the client builds the same walls from
    // the day number alone.
    w.i64(activeMaze().day());
    // The map the body was put in: which realm, how big it is, and its exact
    // grid. Encoded, so a large map does not sit on the socket's backpressure
    // ceiling; it is the same grid collision runs on and cannot drift from it.
    writeMapGrid(w, *terrain_, world_.get<Transform>(entity).realm);
    connection.send(w);
    // The client's profile is the account's, and a body in the ring plays on
    // the arena kit instead; the maze body is on its own track. Restated here
    // so the panels show what the flower actually has from the first frame.
    sendProfile(session, connection);
}

void GameServer::handleLeave(Session& session, net::Connection& connection) {
    if (!session.playing()) return;
    revokeTempAdmin(session.connection);
    persistPlayer(session);
    despawnPlayer(session, true);
    sendProfile(session, connection);
}

void GameServer::handleInput(Session& session, ByteReader& reader) {
    const net::InputFrame input = net::InputFrame::read(reader);
    if (!reader.ok() || !session.playing()) return;
    if (!spend(session.inputAllowance)) return;

    // A replayed or reordered input must not move the player twice. TCP gives
    // ordering, but a client is free to send its own duplicates.
    if (input.sequence <= session.lastInputSequence) return;
    session.lastInputSequence = input.sequence;

    if (PlayerInput* state = world_.tryGet<PlayerInput>(session.entity)) {
        state->current = input;
        state->aimDirection = Vec2::fromAngle(input.aimAngle);
    }

    // The window the client is drawing rides every input packet, so a resize or
    // a zoom widens what is replicated on the next tick rather than at the next
    // join. Zero means "unchanged", which is what a client that never learned
    // to report it sends.
    if (input.viewportWidth > 0 && input.viewportHeight > 0) {
        if (PlayerLocation* location = world_.tryGet<PlayerLocation>(session.entity)) {
            location->viewport = {clamp(static_cast<double>(input.viewportWidth), 320.0, kMaxViewportAxis),
                                  clamp(static_cast<double>(input.viewportHeight), 240.0, kMaxViewportAxis)};
        }
    }
}

namespace {

/// True when a chat line names a raid tier as a bare word.
///
/// The reference tests `/\b(super|unique)\b/i`, and the word boundary is the
/// whole point: "supercell" is not a raid call, and neither is a name that
/// happens to contain the letters. Ultra is deliberately absent -- bots treat
/// an ultra as a mob to fight, not as a rally point.
bool mentionsRaidTier(const std::string& text) {
    static const char* const kWords[] = {"super", "unique"};
    const auto wordChar = [](unsigned char c) {
        return std::isalnum(c) != 0 || c == '_';
    };
    for (const char* word : kWords) {
        const std::size_t length = std::char_traits<char>::length(word);
        for (std::size_t at = 0; at + length <= text.size(); ++at) {
            bool match = true;
            for (std::size_t i = 0; i < length && match; ++i) {
                match = std::tolower(static_cast<unsigned char>(text[at + i])) == word[i];
            }
            if (!match) continue;
            if (at > 0 && wordChar(static_cast<unsigned char>(text[at - 1]))) continue;
            if (at + length < text.size() &&
                wordChar(static_cast<unsigned char>(text[at + length]))) {
                continue;
            }
            return true;
        }
    }
    return false;
}

} // namespace

void GameServer::handleChat(Session& session, net::Connection& connection, ByteReader& reader) {
    const std::string raw = reader.str();
    if (!reader.ok() || !session.authenticated()) return;
    const std::string text = sanitizeChat(raw);
    if (text.empty()) return;

    // A leading slash is a command, and a command is answered rather than
    // said. This has to come BEFORE the mute check: a muted player is barred
    // from talking to other players, not from asking the server questions
    // about their own account.
    //
    // It also spends a DIFFERENT budget. The chat allowance exists to stop one
    // player flooding everyone else, and a command's output goes back to its
    // sender alone -- billed to the chat bucket, four commands emptied it and
    // the console became one command every two seconds.
    if (!text.empty() && text[0] == '/') {
        if (!spend(session.commandAllowance)) {
            sendNotice(connection, net::NoticeSeverity::Warning,
                       "You are sending commands too quickly.");
            return;
        }
        if (handleChatCommand(session, connection, text)) return;
    }

    if (!spend(session.chatAllowance)) {
        sendNotice(connection, net::NoticeSeverity::Warning, "You are sending messages too quickly.");
        return;
    }

    // Everything from here is broadcast to other players, which is exactly
    // what a mute blocks.
    const Account* account = database_.findUser(session.username);
    if (account != nullptr && account->muted) {
        sendSystem(connection, "<span style=\"color: #ff8866;\">You are muted and cannot "
                               "send chat messages.</span>");
        return;
    }

    // The body the line is said FROM, so every client can float it over that
    // flower. Zero while the speaker is on the title screen or dead -- there
    // is nothing in the world to anchor a bubble to then, and the line is
    // still printed in the transcript.
    std::uint32_t speakerNetId = 0;
    if (session.playing()) {
        if (const NetId* id = world_.tryGet<NetId>(session.entity)) speakerNetId = id->value;
    }
    broadcastChat(net::ChatChannel::Global, session.username, text, speakerNetId);

    // Somebody saying "super" or "unique" rallies every bot onto the best boss
    // in the world, exactly as the reference's chat handler does. Only those
    // two words: an ultra is a high-tier mob to fight, never a raid to call.
    // No-ops when no qualifying boss exists.
    if (mentionsRaidTier(text)) triggerBotRaid(clockMillis_);
}

void GameServer::handleSetLoadout(Session& session, ByteReader& reader) {
    const std::uint8_t slot = reader.u8();
    const std::uint16_t petalIndex = reader.u16();
    const Rarity rarity = clampRarity(reader.u8());
    if (!reader.ok() || !session.authenticated()) return;
    if (slot >= kLoadoutSlots) return;
    if (petalIndex != kNoPetal && petalIndex >= content().petalCount()) return;
    if (session.playing() && session.realm == Realm::Maze) {
        // The maze body plays a DERIVED ring -- the account's, one rarity down
        // -- and the reference locks the loadout for the run rather than let
        // an edit made in maze terms be persisted in regular ones.
        if (net::Connection* connection = listener_.find(session.connection)) {
            sendNotice(*connection, net::NoticeSeverity::Warning,
                       "Your loadout is locked inside the maze.");
        }
        return;
    }

    PlayerRecord& record = liveRecord(session);
    if (record.loadout.size() < kLoadoutSlots) record.loadout.resize(kLoadoutSlots);

    // Equipping must come out of the inventory, or a client can name any petal
    // it likes and simply be given it.
    if (petalIndex != kNoPetal && !takeFromInventory(record, petalIndex, rarity, 1)) return;

    // Whatever was in the slot goes back to the inventory. Doing this after the
    // take, not before, means a failed take cannot also have emptied the slot.
    if (record.loadout[slot].has_value()) {
        const StoredItem& previous = *record.loadout[slot];
        const std::uint16_t previousIndex = content().petalIndex(previous.petalType);
        if (previousIndex != kInvalidIndex) {
            giveToInventory(record, previousIndex, previous.rarity, 1);
        }
    }

    if (petalIndex == kNoPetal) {
        record.loadout[slot].reset();
    } else {
        StoredItem item;
        item.type = "petal";
        item.petalType = content().petal(petalIndex).id;
        item.rarity = rarity;
        record.loadout[slot] = item;
    }
    database_.markDirty();

    if (session.playing()) applyAccountToSession(session);
    if (net::Connection* connection = listener_.find(session.connection)) {
        sendProfile(session, *connection);
    }
}

void GameServer::handleSwapLoadout(Session& session, ByteReader& reader) {
    const std::uint8_t a = reader.u8();
    const std::uint8_t b = reader.u8();
    if (!reader.ok() || !session.authenticated()) return;
    if (a >= kLoadoutSlots || b >= kLoadoutSlots || a == b) return;
    if (session.playing() && session.realm == Realm::Maze) {
        if (net::Connection* connection = listener_.find(session.connection)) {
            sendNotice(*connection, net::NoticeSeverity::Warning,
                       "Your loadout is locked inside the maze.");
        }
        return;
    }

    PlayerRecord& record = liveRecord(session);
    if (record.loadout.size() < kLoadoutSlots) record.loadout.resize(kLoadoutSlots);
    std::swap(record.loadout[a], record.loadout[b]);
    database_.markDirty();

    if (session.playing()) applyAccountToSession(session);
    if (net::Connection* connection = listener_.find(session.connection)) {
        sendProfile(session, *connection);
    }
}

void GameServer::handleCraft(Session& session, net::Connection& connection, ByteReader& reader) {
    const std::uint16_t petalIndex = reader.u16();
    const Rarity rarity = clampRarity(reader.u8());
    const int count = reader.u16();
    if (!reader.ok() || !session.authenticated()) return;

    ByteWriter w;
    w.u8(static_cast<std::uint8_t>(net::ServerMessage::CraftResult));

    PlayerRecord& record = liveRecord(session);
    const bool valid = count >= kCraftBatch && rarity != Rarity::Apex &&
                       petalIndex < content().petalCount();
    if (!valid || !takeFromInventory(record, petalIndex, rarity, count)) {
        w.boolean(false);
        w.u16(petalIndex);
        w.u8(static_cast<std::uint8_t>(rarity));
        w.u16(0);
        w.u8(0);
        w.str("Not enough petals to craft.");
        connection.send(w);
        return;
    }

    // The whole request is crafted as one POOL rather than as one batch per
    // click: every attempt eats five, and the survivors a failure hands back
    // drop straight into the pool to be tried again, until fewer than five are
    // left. That is what makes the returns actually get crafted instead of
    // piling up in the inventory, and it is why the client plays one spin for
    // a staged xN. Bounded: an attempt removes five and returns at most four,
    // so the pool strictly shrinks.
    // Every equipped clover of the tier being crafted nudges the odds up. The
    // reference counts the PRIMARY ten slots only -- the storage row behind
    // them is not equipped and does not help -- and the bonus is stated in
    // percentage points against a 0..100 roll, which is five ten-thousandths
    // of the fraction this ladder is expressed in.
    constexpr double kCloverCraftBonus = 0.0005;
    const std::uint16_t clover = content().petalIndex("clover");
    int clovers = 0;
    if (clover != kInvalidIndex) {
        const std::size_t equipped =
            std::min<std::size_t>(record.loadout.size(), kLoadoutActiveSlots);
        for (std::size_t i = 0; i < equipped; ++i) {
            if (!record.loadout[i].has_value()) continue;
            const StoredItem& slot = *record.loadout[i];
            if (slot.rarity != rarity) continue;
            if (content().petalIndex(slot.petalType) == clover) ++clovers;
        }
    }
    const double chance =
        std::min(1.0, craftSuccessChance(rarity) + kCloverCraftBonus * clovers);
    int pool = count;
    int crafted = 0;
    while (pool >= kCraftBatch) {
        pool -= kCraftBatch;
        if (rng_.chance(chance)) ++crafted;
        else pool += kCraftBatch - static_cast<int>(1 + rng_.below(kCraftBatch - 1));
    }
    const int petalsReturned = pool;   // the sub-batch tail, 0..4

    if (petalsReturned > 0) giveToInventory(record, petalIndex, rarity, petalsReturned);
    if (crafted > 0) giveToInventory(record, petalIndex, upgradeRarity(rarity), crafted);
    database_.markDirty();

    if (crafted > 0) announceRareCraft(session, petalIndex, upgradeRarity(rarity));

    w.boolean(crafted > 0);
    w.u16(petalIndex);
    w.u8(static_cast<std::uint8_t>(crafted > 0 ? upgradeRarity(rarity) : rarity));
    w.u16(static_cast<std::uint16_t>(crafted));
    w.u8(static_cast<std::uint8_t>(petalsReturned));
    w.str(crafted > 0 ? "" : "The craft failed.");
    connection.send(w);
    sendProfile(session, connection);
}

void GameServer::announceRareCraft(const Session& session, std::uint16_t petalIndex,
                                   Rarity made) {
    // The top three tiers only, and ONE line however many the batch produced:
    // the reference announces the craft, not each petal it yielded.
    if (made != Rarity::Super && made != Rarity::Unique && made != Rarity::Apex) return;
    if (petalIndex >= content().petalCount()) return;

    // The reference's own table, which is not kRarityColors: unique announces
    // in plain white here rather than in the near-white the tier is drawn in.
    const char* tierColor = made == Rarity::Super    ? "#2bffa4"
                            : made == Rarity::Unique ? "#ffffff"
                                                     : "#ff00ff";
    const std::string tier = rarityLabel(made);
    // "An Apex" -- and "An Unique", because the reference tests the LABEL's
    // first letter against the five vowels and 'U' is one of them. Reproduced
    // rather than corrected: the line is the browser's, word for word.
    const std::string article =
        std::string("AEIOUaeiou").find(tier[0]) != std::string::npos ? "An" : "A";
    const std::string petal = content().petal(petalIndex).name;
    const std::string playerName =
        session.displayName.empty() ? session.username : session.displayName;

    // Two renderings of one sentence: chat gets the marked-up one, and the
    // feed stores the flat one, because the panel draws glyph outlines and has
    // no parser to hand a tag to.
    const std::string plain = article + " " + tier + " " + petal + " has been crafted by @" +
                              session.username + " [" + playerName + "]";
    broadcastChat(net::ChatChannel::System, "",
                  std::string("<b style=\"color: ") + tierColor + ";\">" + article + " " + tier +
                      " " + petal + " has been crafted by <b style=\"color: #00ff00;\">@" +
                      session.username + "</b> [<b style=\"color: yellow;\">" + playerName +
                      "</b>]</b>");

    addNotification(made == Rarity::Apex     ? "apex_craft"
                    : made == Rarity::Unique ? "unique_craft"
                                             : "super_craft",
                    plain);
}

void GameServer::bankKills() {
    std::vector<Bounty::Share> ranked;
    std::vector<Entity> recipients;
    // Connections already credited for the corpse in hand; see the loop.
    std::vector<net::ConnectionId> paidAccounts;
    for (const CombatSystem::DeathRecord& death : combat_->deaths()) {
        if (death.wasPlayer) continue;
        const MobType* type = world_.tryGet<MobType>(death.entity);
        if (type == nullptr) continue;

        // A credited killing blow is the gate, exactly as it is in the
        // reference: a mob finished by another mob is nobody's kill and enters
        // nobody's gallery. A pet's kill belongs to the player who summoned it,
        // and combat has already resolved that attribution onto Dead::killer.
        if (death.killer == NULL_ENTITY || !world_.isAlive(death.killer) ||
            !world_.has<PlayerTag>(death.killer)) {
            continue;
        }

        // The gallery entry and the star bounty go to every player who earned
        // LOOT rights on the corpse, not to the finisher alone: five flowers
        // that bring down an apex are five apex kills and five lots of 250
        // stars. Same ledger and the same selectLootRecipients() the XP and
        // drop paths call -- squads, per-tier slot cap and 1% damage floor
        // included -- so the three cannot disagree about who was in on a kill.
        ranked.clear();
        if (const Bounty* bounty = world_.tryGet<Bounty>(death.entity)) {
            for (const Bounty::Share& share : bounty->contributors) {
                if (share.damage <= 0.0) continue;
                if (world_.isAlive(share.player) && !world_.has<PlayerTag>(share.player)) continue;
                ranked.push_back(share);
            }
        }
        // Stable, because the ledger is in first-hit order and the reference's
        // sort is specified stable: on an exact damage tie the slot at the cut
        // belongs to whoever landed their damage first.
        std::stable_sort(ranked.begin(), ranked.end(),
                         [](const Bounty::Share& a, const Bounty::Share& b) {
                             return a.damage > b.damage;
                         });
        const Health* health = world_.tryGet<Health>(death.entity);
        selectLootRecipients(ranked, lootSlotsForRarity(type->rarity), &squadIndex_, recipients,
                             lootDamageFloor(health != nullptr ? health->max : 0.0));

        const std::string mobId = content().mob(type->configIndex).id;
        const int stars = starsForKill(type->rarity);

        paidAccounts.clear();
        for (const Bounty::Share& share : ranked) {
            // Only a flower that landed damage enters the gallery: a squad's
            // passenger is paid its drops and XP, but it did not kill this.
            if (std::find(recipients.begin(), recipients.end(), share.player) ==
                recipients.end()) {
                continue;
            }
            // A contributor who has left still holds their slot -- nobody is
            // promoted into the gap -- but there is no account left to pay.
            Session* session = sessionForEntity(share.player);
            if (session == nullptr || session->userId.empty()) continue;
            // ONE PERSON, ONE KILL. A splitter puts two of somebody's flowers
            // on the same corpse, and both of them are in this ledger; paying
            // each would enter the kill in their gallery twice for the price
            // of wearing the petal. The slot is still spent -- the half that
            // ranked into it keeps it, and nobody is promoted into the gap --
            // which is the same rule loot_eligibility.h applies to drops.
            if (std::find(paidAccounts.begin(), paidAccounts.end(), session->connection) !=
                paidAccounts.end()) {
                continue;
            }
            paidAccounts.push_back(session->connection);

            PlayerRecord& record = database_.progress(session->userId);
            record.recordKill(mobId, type->rarity);

            // Stars are the mythic-and-above bounty. Awarded on the live entity
            // rather than the record so the HUD sees them this tick;
            // persistPlayer copies them back the same way it does XP.
            // Silently: the reference pays the bounty and updates the star
            // counter, and says nothing. A notice per mythic kill is a line
            // every few seconds in a mythic zone.
            if (stars > 0) {
                if (PlayerProgress* live = world_.tryGet<PlayerProgress>(share.player)) {
                    live->stars += stars;
                    record.stars = live->stars;
                } else {
                    record.stars += stars;
                }
            }
            database_.markDirty();

            if (net::Connection* connection = listener_.find(session->connection)) {
                sendProfile(*session, *connection);
            }
        }

        announceBossDefeat(*type, ranked);
    }
}

void GameServer::announceBossDefeat(const MobType& type,
                                    const std::vector<Bounty::Share>& ranked) {
    // The tiers announced on the way out are exactly the tiers announced on the
    // way in -- ONE constant, so raising kAnnouncedRarity cannot leave chat
    // mourning a boss nobody was told about. An ultra dies as quietly as it
    // spawned.
    if (rarityIndex(type.rarity) < rarityIndex(kAnnouncedRarity)) return;
    // The head's death is the animal's. A centipede's beads each carry their
    // own ledger and die one by one, and a line per bead would be ten more
    // deaths than the one spawn line chat was given.
    if (content().mob(type.configIndex).chainBody) return;
    // Credited to the top damage dealer alone, whatever the kill was shared
    // with: `ranked` is already sorted by damage, so that is its first row.
    if (ranked.empty()) return;
    const Session* session = sessionForEntity(ranked.front().player);
    if (session == nullptr || !session->authenticated()) return;

    std::string name = content().mob(type.configIndex).id;
    for (char& c : name) {
        if (c == '_') c = ' ';
    }
    char colorAttribute[32];
    std::snprintf(colorAttribute, sizeof colorAttribute, "#%06x", rarityColor(type.rarity));

    // The flower's name, not the account's, in the brackets -- the account is
    // the @handle before them.
    const std::string playerName =
        session->displayName.empty() ? session->username : session->displayName;
    broadcastChat(net::ChatChannel::System, "",
                  std::string("<b style=\"color: ") + colorAttribute + ";\">A " +
                      rarityLabel(type.rarity) + " " + name +
                      " has been defeated by <span style=\"color: #00ff00;\">@" +
                      session->username + "</span> [<span style=\"color: yellow;\">" +
                      playerName + "</span>]</b>");
}

void GameServer::handleUpgradeSkill(Session& session, net::Connection& connection,
                                    ByteReader& reader) {
    const std::uint8_t rawSkill = reader.u8();
    const int tier = reader.u8();
    if (!reader.ok() || !session.authenticated()) return;
    if (rawSkill >= kSkillCount) return;

    const SkillId id = static_cast<SkillId>(rawSkill);
    PlayerRecord& record = database_.progress(session.userId);
    if (session.playing() && session.realm == Realm::Arena) {
        sendNotice(connection, net::NoticeSeverity::Warning, "Talents are disabled in the arena.");
        return;
    }
    // The maze buys from its own tree with its own points.
    const bool maze = session.playing() && session.realm == Realm::Maze;
    SkillSet& skills = maze ? record.mazeSkills : record.skills;
    const int points = maze ? record.mazeTalentPoints() : record.talentPoints();

    // Tiers are bought one at a time, in order. Accepting an arbitrary target
    // would let a client skip the tiers below it and pay for one of them.
    if (tier < 0 || tier >= skillTierCount(id) || tier != skills.level(id) + 1) {
        sendNotice(connection, net::NoticeSeverity::Warning, "Talents are bought in order.");
        return;
    }
    if (id == SkillId::SecondChance && !skills.secondChanceUnlocked()) {
        sendNotice(connection, net::NoticeSeverity::Warning,
                   std::string("Second Chance needs ") + rarityLabel(kSecondChanceRequirement) +
                       " " + kSkillLabels[static_cast<std::size_t>(kSecondChanceParent)] + ".");
        return;
    }

    const int cost = kTierCost[static_cast<std::size_t>(tier)];
    if (points < cost) {
        sendNotice(connection, net::NoticeSeverity::Warning,
                   "Not enough talent points (need " + std::to_string(cost) + ").");
        return;
    }

    skills.set(id, tier);
    database_.markDirty();
    if (session.playing() && world_.isAlive(session.entity)) applyAccountToSession(session);
    sendProfile(session, connection);
}

void GameServer::handleResetSkills(Session& session, net::Connection& connection) {
    if (!session.authenticated()) return;
    PlayerRecord& record = database_.progress(session.userId);
    if (session.playing() && session.realm == Realm::Arena) {
        sendNotice(connection, net::NoticeSeverity::Warning, "Talents are disabled in the arena.");
        return;
    }
    if (session.playing() && session.realm == Realm::Maze) record.mazeSkills.clear();
    else record.skills.clear();
    database_.markDirty();
    if (session.playing() && world_.isAlive(session.entity)) applyAccountToSession(session);
    sendProfile(session, connection);
    sendNotice(connection, net::NoticeSeverity::Info, "Talents reset; every point refunded.");
}

void GameServer::handleBuyPetal(Session& session, net::Connection& connection, ByteReader& reader) {
    const std::uint16_t petalIndex = reader.u16();
    const Rarity rarity = clampRarity(reader.u8());
    const std::uint8_t offerSlot = reader.u8();
    if (!reader.ok() || !session.authenticated()) return;

    // The client sends what it wants, never what it costs. A price that came
    // off the wire is a price the client chose.
    if (!shopSellsPetal(petalIndex) || !shopSellsRarity(rarity)) {
        sendShopResult(connection, net::ShopResultKind::Purchase, false, 0, "That is not for sale.");
        return;
    }
    // Not from inside the ring. Stars are the ACCOUNT's and so is what they
    // buy, but a flower in the arena is playing out of the run's own bag --
    // so the petal would be bought, charged for, and invisible until the run
    // ended. Refused for the same reason talents are.
    if (session.playing() && session.realm == Realm::Arena) {
        sendShopResult(connection, net::ShopResultKind::Purchase, false,
                       database_.progress(session.userId).stars,
                       "The shop is closed in the arena.");
        return;
    }

    PlayerRecord& record = database_.progress(session.userId);
    // A card off the rotating store costs what that card showed, discount
    // included; anything else costs the full ladder price. The slot is only a
    // claim about WHICH card was clicked -- the offers are regenerated here,
    // and a slot whose petal and tier do not match the current rotation's is a
    // click on a store that has since changed.
    double price = shopPrice(petalIndex, rarity);
    if (offerSlot != net::kNoShopOffer) {
        const std::vector<ShopOffer> offers = shopOffers(shopRotation(shopClockNow()));
        const auto slot = static_cast<std::size_t>(offerSlot);
        if (slot >= offers.size() || offers[slot].petalIndex != petalIndex ||
            offers[slot].rarity != rarity) {
            sendShopResult(connection, net::ShopResultKind::Purchase, false, 0,
                           "That offer has expired.");
            return;
        }
        price = offers[slot].price;
    }
    PlayerProgress* live = session.playing() && world_.isAlive(session.entity)
                               ? world_.tryGet<PlayerProgress>(session.entity)
                               : nullptr;
    const double stars = live ? live->stars : record.stars;
    if (stars < price) {
        sendShopResult(connection, net::ShopResultKind::Purchase, false, 0, "Not enough stars.");
        return;
    }

    // The price AS QUOTED, not a cast of it. shopPrice() floors, so this is
    // already whole -- but the ladder reaches 3.5^9 times a base of a hundred
    // million, which is comfortably past what an int can hold and used to trap
    // or wrap on the way to the subtraction.
    record.stars = stars - price;
    if (live) live->stars = record.stars;
    giveToInventory(record, petalIndex, rarity, 1);
    database_.markDirty();
    sendProfile(session, connection);
    sendShopResult(connection, net::ShopResultKind::Purchase, true, 0, {});
}

/// Redeems a star code.
///
/// The codes live in the database's own `codes` table -- the one the browser
/// build's admin commands write and this build round-trips -- so a code minted
/// against that file works here without a second registry to keep in step.
void GameServer::handleRedeemCode(Session& session, net::Connection& connection,
                                  ByteReader& reader) {
    const std::string typed = reader.str();
    if (!reader.ok() || !session.authenticated()) return;

    // Trimmed and upper-cased before the lookup, exactly as the browser build
    // normalises it: codes are printed in capitals and pasted with whitespace.
    std::string code = typed;
    code.erase(code.begin(),
               std::find_if(code.begin(), code.end(),
                            [](unsigned char c) { return c > ' '; }));
    code.erase(std::find_if(code.rbegin(), code.rend(),
                            [](unsigned char c) { return c > ' '; })
                   .base(),
               code.end());
    for (char& c : code) c = static_cast<char>(std::toupper(static_cast<unsigned char>(c)));

    Json& codes = database_.rawTable("codes");
    if (code.empty() || !codes.contains(code)) {
        sendShopResult(connection, net::ShopResultKind::Redeem, false, 0, "Invalid code");
        return;
    }

    // Read through a const alias: Json's mutable operator[] inserts, and a
    // code this call is about to refuse must not grow keys on the way out.
    const Json& stored = const_cast<const Json&>(codes)[code];
    const int maxUses = stored["maxUses"].asInt(0);
    const int uses = stored["uses"].asInt(0);
    // Keyed on the ACCOUNT, not the socket: a player who reconnects is the
    // same person, and a code that reset with the connection would be
    // unlimited to anyone willing to press Play twice.
    Json owners = stored["usedBy"];
    if (!owners.isArray()) owners = Json::array();
    for (const Json& owner : owners.items()) {
        if (owner.asString() == session.userId) {
            sendShopResult(connection, net::ShopResultKind::Redeem, false, 0,
                           "Code already redeemed");
            return;
        }
    }
    if (maxUses > 0 && uses >= maxUses) {
        sendShopResult(connection, net::ShopResultKind::Redeem, false, 0,
                       "Code has reached maximum uses");
        return;
    }

    const double stars = stored["stars"].asDouble(0);
    PlayerRecord& record = database_.progress(session.userId);
    record.stars += stars;
    if (session.playing() && world_.isAlive(session.entity)) {
        if (PlayerProgress* live = world_.tryGet<PlayerProgress>(session.entity)) {
            live->stars = record.stars;
        }
    }

    owners.push(Json(session.userId));
    Json& entry = codes[code];
    entry["uses"] = Json(uses + 1);
    entry["usedBy"] = std::move(owners);
    // A fully spent code is dropped rather than left to be rejected forever,
    // which is what the browser build does with it.
    if (maxUses > 0 && uses + 1 >= maxUses) codes.erase(code);
    database_.markDirty();

    sendProfile(session, connection);
    sendShopResult(connection, net::ShopResultKind::Redeem, true, stars, {});

    // The star is U+2B50, exactly as the browser writes it. The same save file
    // is read by both builds, so the row stored here has to be the row the
    // browser would have stored -- the shipped face having no glyph for it is
    // the panel's problem to solve, not a reason to write a different history.
    const std::string playerName =
        session.displayName.empty() ? session.username : session.displayName;
    addNotification("star_code", "Star code \"" + code + "\" redeemed by @" + session.username +
                                    " [" + playerName + "]! +" + numberText(stars) +
                                    " \xE2\xAD\x90 Stars");
}

void GameServer::handleSetSkin(Session& session, net::Connection& connection, ByteReader& reader) {
    const std::uint32_t requested = reader.u32();
    if (!reader.ok() || !session.authenticated()) return;

    // Exactly one cosmetic bit, or none. Glitch is deliberately absent: it is
    // a transient effect PlayerVisuals ORs in, not something to wear.
    constexpr std::uint32_t kWearable[] = {PlayerRenderPumpkin, PlayerRenderRobot};
    std::uint32_t flags = PlayerRenderNone;
    for (const std::uint32_t bit : kWearable) {
        if (requested == bit) { flags = bit; break; }
    }
    if (requested != PlayerRenderNone && flags == PlayerRenderNone) return;

    PlayerRecord& record = database_.progress(session.userId);
    record.renderFlags = flags;
    // The mirror of handleEquipSkin's rule. A custom skin WINS over a built-in
    // when the client draws the body, so leaving one on here would make
    // picking a built-in look like it did nothing at all.
    if (flags != PlayerRenderNone) record.equippedSkinId.clear();
    database_.markDirty();
    if (session.playing() && world_.isAlive(session.entity)) {
        PlayerVisuals& visuals = world_.ensure<PlayerVisuals>(session.entity);
        visuals.renderFlags = flags;
        visuals.equippedSkinId = record.equippedSkinId;
    }
    sendProfile(session, connection);
}

// --- user-created skins ----------------------------------------------------
//
// The catalog is one shared, public list: anything published renders on every
// screen that sees the author wearing it, which is exactly why nothing a
// client sends is trusted. sanitizeSkin() runs here as well as in the studio,
// and the id, the author and the timestamp are the server's to assign.
//
// Stored as raw JSON under the database's `customSkins` key rather than as a
// typed table, because that key belongs to the shared inventory.json the
// browser build also reads and writes: a skin published in one build has to
// come back in the other.

namespace {

/// The studio's own reply channel. Every outcome the reference reports --
/// success included -- is a chat line from "Skins", not a notice or a toast.
void sendSkinChat(net::Connection& connection, const std::string& text) {
    ByteWriter w;
    w.u8(static_cast<std::uint8_t>(net::ServerMessage::Chat));
    w.u8(static_cast<std::uint8_t>(net::ChatChannel::System));
    w.str("Skins");
    w.str(text);
    w.u32(0);   // the studio, not a flower: no bubble over anybody
    connection.send(w);
}

/// A guest account, which may play but may not add to the shared catalog.
///
/// The reference tests `/^User\d{8}$/`; this build's guest minting does not
/// zero-pad (client/app_login.cpp), so the digit run is matched at any length rather
/// than at exactly eight -- otherwise the rule would miss the very accounts it
/// exists to stop.
bool isGuestName(const std::string& name) {
    if (name.size() <= 4 || name.compare(0, 4, "User") != 0) return false;
    for (std::size_t i = 4; i < name.size(); ++i) {
        if (name[i] < '0' || name[i] > '9') return false;
    }
    return true;
}

/// Usernames are compared case-insensitively for ownership, as the reference
/// does: the account "Rose" and the author string "rose" are one person.
bool sameUser(const std::string& a, const std::string& b) {
    if (a.size() != b.size()) return false;
    for (std::size_t i = 0; i < a.size(); ++i) {
        if (std::tolower(static_cast<unsigned char>(a[i])) !=
            std::tolower(static_cast<unsigned char>(b[i]))) {
            return false;
        }
    }
    return true;
}

std::string base36(std::uint64_t value) {
    static const char* digits = "0123456789abcdefghijklmnopqrstuvwxyz";
    if (value == 0) return "0";
    std::string out;
    while (value > 0) {
        out += digits[value % 36];
        value /= 36;
    }
    std::reverse(out.begin(), out.end());
    return out;
}

} // namespace

void GameServer::broadcastToAuthenticated(const ByteWriter& message) {
    listener_.each([&](net::Connection& connection) {
        const Session* session = sessionFor(connection.id());
        if (session && session->authenticated()) connection.send(message);
    });
}

void GameServer::broadcastDebugStats() {
    // Drained whether or not anyone is listening, so a window that spanned an
    // empty server does not pour its samples into the first client to join.
    const double avgMillis =
        debugTickSamples_ > 0 ? debugTickAccumMillis_ / debugTickSamples_ : 0.0;
    const double maxMillis = debugTickMaxMillis_;
    debugTickAccumMillis_ = 0;
    debugTickMaxMillis_ = 0;
    debugTickSamples_ = 0;

    bool anyone = false;
    for (const auto& entry : sessions_) {
        if (entry.second.authenticated()) { anyone = true; break; }
    }
    if (!anyone) return;

    ByteWriter w;
    w.u8(static_cast<std::uint8_t>(net::ServerMessage::DebugStats));
    w.f64(static_cast<double>(residentBytes()));
    w.f64(static_cast<double>(heapBytes()));
    w.f32(static_cast<float>(avgMillis));
    w.f32(static_cast<float>(maxMillis));
    broadcastToAuthenticated(w);
}

void GameServer::sendSkinCatalog(Session& session, net::Connection& connection) {
    const Json& skins = database_.rawTable("customSkins");
    const PlayerRecord& record = database_.progress(session.userId);

    ByteWriter w;
    w.u8(static_cast<std::uint8_t>(net::ServerMessage::SkinCatalog));
    // Advisory only: it decides whether the takedown button is drawn and
    // whether the chat autocomplete offers the /admin rows. Every delete, and
    // every admin command, is re-checked server-side regardless of what the
    // client believes -- so a temporary grant may safely raise it, which is
    // how a grantee's console appears without them logging out and back in.
    w.boolean(effectiveAdmin(session));
    w.str(record.equippedSkinId);
    const std::size_t at = w.reserveU16();
    std::uint16_t count = 0;
    for (const std::string& id : skins.keys()) {
        const CustomSkin skin = skinFromJson(skins[id]);
        if (skin.id.empty() || skin.shapes.empty()) continue;
        writeCustomSkin(w, skin);
        ++count;
    }
    w.patchU16(at, count);
    connection.send(w);
}

void GameServer::handlePublishSkin(Session& session, net::Connection& connection,
                                   ByteReader& reader) {
    const std::string name = reader.str();
    const std::uint8_t shapeCount = reader.u8();
    std::vector<SkinShape> shapes;
    shapes.reserve(std::min<std::size_t>(shapeCount, kMaxSkinShapes));
    for (int i = 0; i < shapeCount; ++i) {
        SkinShape shape;
        if (readSkinShape(reader, shape) && shapes.size() < static_cast<std::size_t>(kMaxSkinShapes)) {
            shapes.push_back(std::move(shape));
        }
    }
    if (!reader.ok() || !session.authenticated()) return;

    if (isGuestName(session.username)) {
        sendSkinChat(connection, "Create a (non-guest) account to publish skins.");
        return;
    }
    const SkinCheck check = sanitizeSkin(name, shapes);
    if (!check.ok()) {
        sendSkinChat(connection, check.error);
        return;
    }

    Json& catalog = database_.rawTable("customSkins");
    // Read through a const view: Json's non-const operator[] CREATES the key
    // it is handed, so a lookup that misses would quietly grow the table.
    const Json& stored = catalog;
    int mine = 0;
    for (const std::string& id : stored.keys()) {
        if (sameUser(stored[id]["author"].asString(), session.username)) ++mine;
    }
    if (mine >= kMaxSkinsPerUser) {
        sendSkinChat(connection, "You've reached the limit of " +
                                     std::to_string(kMaxSkinsPerUser) +
                                     " published skins. Delete one first.");
        return;
    }

    CustomSkin skin;
    // Time plus a random tail, as the reference mints it: the clock alone
    // collides when two players publish in the same millisecond.
    skin.id = "sk_" + base36(static_cast<std::uint64_t>(database_.nowMillis())) + "_" +
              base36(rng_.next() % 2176782336ull);
    skin.name = check.name;
    skin.author = session.username;
    skin.shapes = check.shapes;
    skin.createdAt = static_cast<double>(database_.nowMillis());
    catalog[skin.id] = skinToJson(skin);
    database_.markDirty();

    ByteWriter w;
    w.u8(static_cast<std::uint8_t>(net::ServerMessage::SkinPublished));
    writeCustomSkin(w, skin);
    // Everyone, not just the author: a skin nobody else has cannot be drawn on
    // the player wearing it.
    broadcastToAuthenticated(w);
    sendSkinChat(connection, "Published \"" + skin.name + "\". It's now in the Browse tab.");
}

void GameServer::handleEquipSkin(Session& session, net::Connection& connection,
                                 ByteReader& reader) {
    const std::string id = reader.str();
    if (!reader.ok() || !session.authenticated()) return;

    const Json& catalog = database_.rawTable("customSkins");
    if (!id.empty() && !catalog[id].isObject()) {
        sendSkinChat(connection, "That skin no longer exists.");
        return;
    }

    PlayerRecord& record = database_.progress(session.userId);
    record.equippedSkinId = id;
    // A custom skin replaces any built-in cosmetic so the two cannot fight
    // over the same body.
    if (!id.empty()) record.renderFlags = PlayerRenderNone;
    database_.markDirty();
    if (session.playing() && world_.isAlive(session.entity)) {
        // Onto the live body too, or the change waits for the next respawn:
        // the snapshot reads the component, never the account row.
        PlayerVisuals& visuals = world_.ensure<PlayerVisuals>(session.entity);
        visuals.renderFlags = record.renderFlags;
        visuals.equippedSkinId = id;
    }
}

void GameServer::handleDeleteSkin(Session& session, net::Connection& connection,
                                  ByteReader& reader) {
    const std::string id = reader.str();
    if (!reader.ok() || !session.authenticated()) return;

    Json& catalog = database_.rawTable("customSkins");
    const Json& stored = catalog;
    if (!stored[id].isObject()) return;
    const std::string author = stored[id]["author"].asString();
    const std::string name = stored[id]["name"].asString();

    const bool owner = sameUser(author, session.username);
    if (!session.admin && !owner) {
        sendSkinChat(connection, "You can only take down your own skins.");
        return;
    }
    catalog.erase(id);
    database_.markDirty();

    ByteWriter w;
    w.u8(static_cast<std::uint8_t>(net::ServerMessage::SkinDeleted));
    w.str(id);
    broadcastToAuthenticated(w);
    sendSkinChat(connection, owner ? "Deleted \"" + name + "\"."
                                   : "Took down \"" + name + "\" by " + author + ".");
}

void GameServer::handleLeaderboard(const Session& session, net::Connection& connection) {
    // Ranked over ACCOUNTS, not over the players currently online: the board is
    // a record of progress, and a top player who logged off has not lost it.
    struct Row {
        const std::string* name;
        double totalXp;
    };
    std::vector<Row> rows;
    rows.reserve(database_.userCount());
    for (const std::string& username : database_.usernames()) {
        const Account* account = database_.findUser(username);
        if (account == nullptr) continue;
        // Staff are off the board. The browser build's getLeaderboard() takes
        // includeAdmins and the client only ever passes false, so an admin
        // account would rank here and nowhere in the reference.
        if (account->admin) continue;
        const PlayerRecord* record = database_.findProgress(account->id);
        rows.push_back({&account->username, record ? record->totalXp : 0.0});
    }

    // The browser client asks for limit=50 and the panel scrolls all fifty;
    // still one byte on the wire, so the count below stays a u8.
    constexpr std::size_t kRows = 50;
    const std::size_t shown = std::min(kRows, rows.size());
    std::partial_sort(rows.begin(), rows.begin() + static_cast<long>(shown), rows.end(),
                      [](const Row& a, const Row& b) { return a.totalXp > b.totalXp; });

    // The count beside the title is over every account, not over the 25 rows
    // that fit. The active-today figure rides along only for an admin, which is
    // how the browser's payload leaves the field out for everyone else -- and 0
    // is the same answer as "absent" to the panel, since the asker is always
    // active today themselves.
    const std::int64_t dayAgo = database_.nowMillis() - 24 * 60 * 60 * 1000;
    std::uint32_t activeToday = 0;
    if (session.admin) {
        for (const std::string& username : database_.usernames()) {
            const Account* account = database_.findUser(username);
            if (account && account->lastActiveAtMillis >= dayAgo) ++activeToday;
        }
    }

    ByteWriter w;
    w.u8(static_cast<std::uint8_t>(net::ServerMessage::Leaderboard));
    w.u8(static_cast<std::uint8_t>(shown));
    w.u32(static_cast<std::uint32_t>(database_.userCount()));
    w.u32(activeToday);
    for (std::size_t i = 0; i < shown; ++i) {
        w.str(*rows[i].name);
        w.u16(static_cast<std::uint16_t>(levelFromTotalXp(rows[i].totalXp).level));
        w.f64(rows[i].totalXp);
    }
    connection.send(w);
}

// ---------------------------------------------------------------------------
// Notifications
// ---------------------------------------------------------------------------

void GameServer::addNotification(const std::string& type, const std::string& message) {
    // rawArrayTable, never rawTable: this is the one unmodelled table the
    // browser stores as an ARRAY, and coercing it would replace the whole feed
    // with an empty object.
    Json& feed = database_.rawArrayTable("notifications");
    const std::int64_t now = database_.nowMillis();
    Json entry = Json::object();
    entry["id"] = std::to_string(now) + "-" + std::to_string(++notificationSequence_);
    entry["type"] = type;
    entry["message"] = message;
    entry["timestamp"] = static_cast<double>(now);
    feed.push(std::move(entry));

    // Trimmed from the FRONT, because the feed is in the order it was written
    // and the newest row is the one just pushed.
    std::vector<Json>& rows = feed.items();
    if (rows.size() > kNotificationHistory) {
        rows.erase(rows.begin(),
                   rows.begin() + static_cast<std::ptrdiff_t>(rows.size() - kNotificationHistory));
    }
    database_.markDirty();
}

void GameServer::handleNotifications(net::Connection& connection, ByteReader& reader) {
    const std::uint16_t limit = reader.u16();
    const double before = reader.f64();
    if (!reader.ok()) return;

    // Read through storedTable(), never rawTable(): this is the one unmodelled
    // table the browser stores as an ARRAY, and rawTable() would coerce the
    // whole feed to an empty object on the way past.
    const Json& table = database_.storedTable("notifications");

    struct Row {
        const Json* entry;
        double stamp;
    };
    std::vector<Row> rows;
    if (table.isArray()) {
        rows.reserve(table.size());
        for (const Json& entry : table.items()) {
            const double stamp = entry["timestamp"].asDouble();
            // `before` is exclusive, which is what lets a page request start
            // exactly at the oldest entry the client already holds.
            if (before > 0 && stamp >= before) continue;
            rows.push_back({&entry, stamp});
        }
    }
    std::sort(rows.begin(), rows.end(),
              [](const Row& a, const Row& b) { return a.stamp > b.stamp; });

    const std::size_t want = std::min<std::size_t>(limit == 0 ? 50 : limit, 200);
    const std::size_t shown = std::min(want, rows.size());

    ByteWriter w;
    w.u8(static_cast<std::uint8_t>(net::ServerMessage::Notifications));
    // "More" is a full page, not a count of what is left: the browser reads
    // `batch.length === limit` and so pages one request past the end.
    w.boolean(shown == want);
    w.u16(static_cast<std::uint16_t>(shown));
    for (std::size_t i = 0; i < shown; ++i) {
        const Json& entry = *rows[i].entry;
        w.str(entry["id"].asString());
        w.u8(static_cast<std::uint8_t>(notificationKind(entry["type"].asString())));
        w.str(entry["message"].asString());
        w.f64(rows[i].stamp);
    }
    connection.send(w);
}

// ---------------------------------------------------------------------------
// Guilds
// ---------------------------------------------------------------------------

std::string GameServer::guildNameForUser(const std::string& username) const {
    if (username.empty()) return {};
    const Json& guilds = database_.storedTable("guilds");
    if (!guilds.isObject()) return {};
    for (const std::string& key : guilds.keys()) {
        if (guildMemberIndex(guilds[key], username) >= 0) return key;
    }
    return {};
}

Session* GameServer::sessionForUser(const std::string& username) {
    const std::string key = lowerCase(username);
    if (key.empty()) return nullptr;
    for (auto& [id, session] : sessions_) {
        if (session.authenticated() && lowerCase(session.username) == key) return &session;
    }
    return nullptr;
}

net::Connection* GameServer::connectionForUser(const std::string& username) {
    const Session* session = sessionForUser(username);
    return session ? listener_.find(session->connection) : nullptr;
}

void GameServer::sendChatTo(net::Connection& connection, net::ChatChannel channel,
                            const std::string& author, const std::string& text) {
    ByteWriter w;
    w.u8(static_cast<std::uint8_t>(net::ServerMessage::Chat));
    w.u8(static_cast<std::uint8_t>(channel));
    w.str(author);
    w.str(text);
    // Nobody in the world said this: a directed line is the server answering
    // one player, so it prints in the transcript and floats over no flower.
    w.u32(0);
    connection.send(w);
}

void GameServer::sendGuildRoster(net::Connection& connection, const Json& guild) {
    const Json& members = guild["memberUsernames"];

    ByteWriter w;
    w.u8(static_cast<std::uint8_t>(net::ServerMessage::GuildUpdate));
    w.boolean(true);
    w.str(guild["name"].asString());
    w.str(guild["leaderUsername"].asString());
    w.u16(static_cast<std::uint16_t>(members.size()));
    for (std::size_t i = 0; i < members.size(); ++i) {
        const std::string member = members[i].asString();
        w.str(member);
        w.boolean(sessionForUser(member) != nullptr);
    }
    connection.send(w);
}

void GameServer::sendNoGuild(net::Connection& connection) {
    ByteWriter w;
    w.u8(static_cast<std::uint8_t>(net::ServerMessage::GuildUpdate));
    w.boolean(false);
    connection.send(w);
}

void GameServer::broadcastGuildRoster(const Json& guild) {
    // Rebuilt per member rather than sent once: the online flags are the same
    // for everyone, but the roster is only sent to people in the guild, and
    // there is no room concept here to address them as a group.
    const Json& members = guild["memberUsernames"];
    for (std::size_t i = 0; i < members.size(); ++i) {
        if (net::Connection* peer = connectionForUser(members[i].asString())) {
            sendGuildRoster(*peer, guild);
        }
    }
}

void GameServer::sendGuildState(const Session& session, net::Connection& connection) {
    const std::string name = guildNameForUser(session.username);
    if (name.empty()) {
        sendNoGuild(connection);
        return;
    }
    // Every member is told, not just this one: somebody logging in changes the
    // online column of every roster that lists them.
    broadcastGuildRoster(database_.storedTable("guilds")[name]);
}

void GameServer::handleGuildCreate(Session& session, net::Connection& connection,
                                   ByteReader& reader) {
    const std::string raw = reader.str();
    if (!reader.ok() || !session.authenticated()) return;
    guildCreate(session, connection, raw);
}

void GameServer::guildCreate(Session& session, net::Connection& connection,
                             const std::string& raw) {
    if (!session.authenticated()) return;

    const std::string name = normalizeGuildName(raw);
    if (name.empty()) {
        sendNotice(connection, net::NoticeSeverity::Warning, "Guild name cannot be empty.");
        return;
    }
    if (!validGuildName(name)) {
        sendNotice(connection, net::NoticeSeverity::Warning,
                   "Guild name must be exactly 5 alphanumeric characters (A–Z, 0–9).");
        return;
    }
    if (!guildNameForUser(session.username).empty()) {
        sendNotice(connection, net::NoticeSeverity::Warning, "You are already in a guild.");
        return;
    }

    Json& guilds = database_.rawTable("guilds");
    if (guilds.contains(name)) {
        sendNotice(connection, net::NoticeSeverity::Warning,
                   "A guild named \"" + name + "\" already exists.");
        return;
    }

    Json guild = Json::object();
    guild["name"] = name;
    guild["leaderUsername"] = session.username;
    Json members = Json::array();
    members.push(session.username);
    guild["memberUsernames"] = std::move(members);
    guild["createdAt"] = static_cast<double>(database_.nowMillis());
    guilds[name] = std::move(guild);
    database_.markDirty();

    sendNotice(connection, net::NoticeSeverity::Good, "Guild \"" + name + "\" created.");
    broadcastGuildRoster(guilds[name]);
}

void GameServer::handleGuildInvite(Session& session, net::Connection& connection,
                                   ByteReader& reader) {
    const std::string raw = reader.str();
    if (!reader.ok() || !session.authenticated()) return;
    guildInvite(session, connection, raw);
}

void GameServer::guildInvite(Session& session, net::Connection& connection,
                             const std::string& raw) {
    if (!session.authenticated()) return;

    const std::string guildName = guildNameForUser(session.username);
    if (guildName.empty()) {
        sendNotice(connection, net::NoticeSeverity::Warning, "You are not in a guild.");
        return;
    }
    const Json& guild = database_.storedTable("guilds")[guildName];
    if (lowerCase(guild["leaderUsername"].asString()) != lowerCase(session.username)) {
        sendNotice(connection, net::NoticeSeverity::Warning,
                   "Only the guild leader can invite players.");
        return;
    }
    if (guild["memberUsernames"].size() >= kMaxGuildSize) {
        sendNotice(connection, net::NoticeSeverity::Warning,
                   "Guild is full (max " + std::to_string(kMaxGuildSize) + " members).");
        return;
    }

    const std::string target = trimmed(raw);
    if (target.empty()) {
        sendNotice(connection, net::NoticeSeverity::Warning,
                   "Please provide a username to invite.");
        return;
    }
    if (database_.findUser(target) == nullptr) {
        sendNotice(connection, net::NoticeSeverity::Warning,
                   "No player named \"" + target + "\" exists.");
        return;
    }
    if (lowerCase(target) == lowerCase(session.username)) {
        sendNotice(connection, net::NoticeSeverity::Warning, "You cannot invite yourself.");
        return;
    }
    if (!guildNameForUser(target).empty()) {
        sendNotice(connection, net::NoticeSeverity::Warning, target + " is already in a guild.");
        return;
    }

    const std::string key = lowerCase(target);
    const std::int64_t now = database_.nowMillis();
    const auto existing = guildInvites_.find(key);
    if (existing != guildInvites_.end() && existing->second.expiresAtMillis > now) {
        sendNotice(connection, net::NoticeSeverity::Warning,
                   target + " already has a pending guild invite.");
        return;
    }

    guildInvites_[key] = {guildName, session.username, now + kGuildInviteMillis};
    sendNotice(connection, net::NoticeSeverity::Good, "Guild invite sent to " + target + ".");

    if (net::Connection* peer = connectionForUser(target)) {
        ByteWriter w;
        w.u8(static_cast<std::uint8_t>(net::ServerMessage::GuildInviteReceived));
        w.str(guildName);
        w.str(session.username);
        peer->send(w);
        sendNotice(*peer, net::NoticeSeverity::Info,
                   "@" + session.username + " has invited you to guild \"" + guildName +
                       "\". Use /guild-accept or /guild-decline.");
    }
}

void GameServer::handleGuildAccept(Session& session, net::Connection& connection) {
    if (!session.authenticated()) return;
    const std::string key = lowerCase(session.username);
    const auto invite = guildInvites_.find(key);
    if (invite == guildInvites_.end()) {
        sendNotice(connection, net::NoticeSeverity::Warning, "You have no pending guild invite.");
        return;
    }
    // Every failure below drops the invitation: an invite that cannot be taken
    // up is spent, or a player refused by a full guild would keep a banner they
    // can never clear.
    const std::string guildName = invite->second.guildName;
    if (invite->second.expiresAtMillis < database_.nowMillis()) {
        guildInvites_.erase(invite);
        sendNotice(connection, net::NoticeSeverity::Warning, "Guild invite has expired.");
        return;
    }

    Json& guilds = database_.rawTable("guilds");
    if (!guilds.contains(guildName)) {
        guildInvites_.erase(invite);
        sendNotice(connection, net::NoticeSeverity::Warning, "Guild no longer exists.");
        return;
    }
    Json& guild = guilds[guildName];
    if (guild["memberUsernames"].size() >= kMaxGuildSize) {
        guildInvites_.erase(invite);
        sendNotice(connection, net::NoticeSeverity::Warning, "Guild is full.");
        return;
    }
    if (!guildNameForUser(session.username).empty()) {
        guildInvites_.erase(invite);
        sendNotice(connection, net::NoticeSeverity::Warning, "You are already in a guild.");
        return;
    }

    guild["memberUsernames"].push(session.username);
    guildInvites_.erase(invite);
    database_.markDirty();

    const std::string author = "[Guild " + guildName + "]";
    const Json& members = guild["memberUsernames"];
    for (std::size_t i = 0; i < members.size(); ++i) {
        if (net::Connection* peer = connectionForUser(members[i].asString())) {
            sendChatTo(*peer, net::ChatChannel::System, author,
                       session.username + " has joined the guild.");
        }
    }
    broadcastGuildRoster(guild);
}

void GameServer::handleGuildDecline(Session& session, net::Connection& connection) {
    if (!session.authenticated()) return;
    guildInvites_.erase(lowerCase(session.username));
    sendNotice(connection, net::NoticeSeverity::Info, "Guild invite declined.");
}

void GameServer::handleGuildLeave(Session& session, net::Connection& connection) {
    if (!session.authenticated()) return;
    const std::string guildName = guildNameForUser(session.username);
    if (guildName.empty()) {
        sendNotice(connection, net::NoticeSeverity::Warning, "You are not in a guild.");
        return;
    }

    Json& guilds = database_.rawTable("guilds");
    Json& guild = guilds[guildName];
    const int at = guildMemberIndex(guild, session.username);
    if (at >= 0) {
        Json& members = guild["memberUsernames"];
        members.items().erase(members.items().begin() + at);
    }

    // The client is told it has no guild before anything else, so the panel
    // flips to the no-guild view on the same frame the confirmation lands.
    sendNoGuild(connection);
    sendNotice(connection, net::NoticeSeverity::Info, "You have left the guild.");

    if (guild["memberUsernames"].size() == 0) {
        // The last member out disbands it rather than leaving an empty guild
        // holding a five-character name nobody else can claim.
        guilds.erase(guildName);
        database_.markDirty();
        return;
    }

    std::string promoted;
    if (lowerCase(guild["leaderUsername"].asString()) == lowerCase(session.username)) {
        promoted = guild["memberUsernames"][std::size_t{0}].asString();
        guild["leaderUsername"] = promoted;
    }
    database_.markDirty();

    const std::string author = "[Guild " + guildName + "]";
    const Json& members = guild["memberUsernames"];
    for (std::size_t i = 0; i < members.size(); ++i) {
        net::Connection* peer = connectionForUser(members[i].asString());
        if (peer == nullptr) continue;
        sendChatTo(*peer, net::ChatChannel::System, author,
                   session.username + " has left the guild.");
        if (!promoted.empty()) {
            sendChatTo(*peer, net::ChatChannel::System, author,
                       promoted + " is now the guild leader.");
        }
    }
    broadcastGuildRoster(guild);
}

void GameServer::handleGuildKick(Session& session, net::Connection& connection,
                                 ByteReader& reader) {
    const std::string raw = reader.str();
    if (!reader.ok() || !session.authenticated()) return;
    guildKick(session, connection, raw);
}

void GameServer::guildKick(Session& session, net::Connection& connection,
                           const std::string& raw) {
    if (!session.authenticated()) return;

    const std::string guildName = guildNameForUser(session.username);
    if (guildName.empty()) {
        sendNotice(connection, net::NoticeSeverity::Warning, "You are not in a guild.");
        return;
    }
    Json& guild = database_.rawTable("guilds")[guildName];
    if (lowerCase(guild["leaderUsername"].asString()) != lowerCase(session.username)) {
        sendNotice(connection, net::NoticeSeverity::Warning,
                   "Only the guild leader can kick players.");
        return;
    }
    const std::string target = trimmed(raw);
    if (lowerCase(target) == lowerCase(session.username)) {
        sendNotice(connection, net::NoticeSeverity::Warning,
                   "You cannot kick yourself. Use /guild-leave instead.");
        return;
    }
    const int at = guildMemberIndex(guild, target);
    if (at < 0) {
        sendNotice(connection, net::NoticeSeverity::Warning, target + " is not in your guild.");
        return;
    }

    // The stored spelling, not what the leader typed: the kicked player's own
    // messages read back the name their account carries.
    const std::string member = guild["memberUsernames"][static_cast<std::size_t>(at)].asString();
    Json& members = guild["memberUsernames"];
    members.items().erase(members.items().begin() + at);
    database_.markDirty();

    const std::string author = "[Guild " + guildName + "]";
    const Json& remaining = guild["memberUsernames"];
    for (std::size_t i = 0; i < remaining.size(); ++i) {
        if (net::Connection* peer = connectionForUser(remaining[i].asString())) {
            sendChatTo(*peer, net::ChatChannel::System, author,
                       member + " was kicked from the guild by " + session.username + ".");
        }
    }
    if (net::Connection* peer = connectionForUser(member)) {
        sendNoGuild(*peer);
        sendNotice(*peer, net::NoticeSeverity::Bad,
                   "You were kicked from guild \"" + guildName + "\".");
    }
    broadcastGuildRoster(guild);
}

// ---------------------------------------------------------------------------
// Scheduled restart
// ---------------------------------------------------------------------------

namespace {

/// How long before a restart each warning goes out, longest first. The
/// reference's RESTART_WARNINGS_MS.
constexpr std::array<double, 4> kRestartWarnings = {600000.0, 300000.0, 60000.0, 10000.0};

/// "daily" is the only reason with a friendlier name than itself.
std::string restartReasonText(const std::string& reason) {
    return reason == "daily" ? "daily maintenance" : reason;
}

/// The reference prefixes both of these with U+26A0. It is dropped here for
/// the same reason /guild-info's bullet was: there is one font in this build
/// and it cannot draw that glyph, so the sign would arrive as a hole in the
/// sentence. The words are the reference's, unchanged.
std::string restartWarning(double millis, const std::string& reason) {
    if (millis >= 60000.0) {
        const long minutes = std::lround(millis / 60000.0);
        return "<span style=\"color:#ffb74d;\">Server will restart in " +
               std::to_string(minutes) + (minutes == 1 ? " minute (" : " minutes (") +
               restartReasonText(reason) + ").</span>";
    }
    const long seconds = std::lround(millis / 1000.0);
    return "<span style=\"color:#ff6b6b;\">Server restarting in " + std::to_string(seconds) +
           (seconds == 1 ? " second!</span>" : " seconds!</span>");
}

} // namespace

bool GameServer::scheduleRestart(double delayMillis, const std::string& reason) {
    // A restart that has already announced itself and closed the door is not
    // one anybody can reschedule.
    if (restart_.firing) return false;
    if (delayMillis < 0) delayMillis = 0;

    restart_.pending = true;
    restart_.atMillis = clockMillis_ + delayMillis;
    restart_.reason = reason;
    // Warnings longer than the delay itself are skipped outright rather than
    // fired late: "restarting in 10 minutes" said one second before the exit
    // is worse than saying nothing.
    restart_.warningsSaid = 0;
    while (restart_.warningsSaid < kRestartWarnings.size() &&
           kRestartWarnings[restart_.warningsSaid] >= delayMillis) {
        ++restart_.warningsSaid;
    }
    return true;
}

bool GameServer::cancelScheduledRestart() {
    if (restart_.firing || !restart_.pending) return false;
    restart_ = ScheduledRestart{};
    return true;
}

bool GameServer::scheduledRestartInfo(double& remainingMillis, std::string& reason) const {
    if (!restart_.pending && !restart_.firing) return false;
    remainingMillis = std::max(0.0, restart_.atMillis - clockMillis_);
    reason = restart_.reason;
    return true;
}

void GameServer::serviceScheduledRestart(double nowMillis) {
    if (restart_.firing) {
        // The gap between the last word and the exit exists so the socket
        // writes actually leave: stopping in the same breath as the broadcast
        // drops the message that explains the disconnect.
        //
        // Non-zero, and set before the stop so whoever reads it after the loop
        // cannot see a half-finished answer: a supervisor that is told the
        // server exited cleanly leaves it down, and a restart nobody restarts
        // is just a shutdown with a countdown. See exitCode().
        if (nowMillis >= restart_.stopAtMillis) {
            exitCode_ = kRestartExit;
            stop();
        }
        return;
    }
    if (!restart_.pending) return;

    const double remaining = restart_.atMillis - nowMillis;
    while (restart_.warningsSaid < kRestartWarnings.size() &&
           remaining <= kRestartWarnings[restart_.warningsSaid]) {
        broadcastChat(net::ChatChannel::System, "System",
                      restartWarning(kRestartWarnings[restart_.warningsSaid], restart_.reason));
        ++restart_.warningsSaid;
    }
    if (remaining > 0) return;

    restart_.pending = false;
    restart_.firing = true;
    restart_.stopAtMillis = nowMillis + 1000.0;
    broadcastChat(net::ChatChannel::System, "System",
                  "<span style=\"color:#ff6b6b;\">Server restarting now (" +
                      restartReasonText(restart_.reason) +
                      "). Reconnecting shortly...</span>");
    std::printf("[restart] scheduled restart triggered (reason: %s)\n", restart_.reason.c_str());
}

// ---------------------------------------------------------------------------
// Self-update
// ---------------------------------------------------------------------------

void GameServer::serviceAutoUpdate() {
    net::Connection* requester =
        updateRequester_ != 0 ? listener_.find(updateRequester_) : nullptr;

    // Drained whether or not anybody is still listening: the lines are also
    // the JS side's console output, and leaving them queued would replay a
    // finished update's whole log at the next admin who asks for one.
    for (const std::string& line : autoupdate::drainLog()) {
        if (requester != nullptr) sendSystem(*requester, line);
    }

    switch (autoupdate::takeOutcome()) {
        case autoupdate::Outcome::Installed: {
            const bool scheduled = scheduleRestart(updateRestartDelayMillis_, "update");
            if (requester == nullptr) break;
            if (scheduled) {
                const long seconds = std::lround(updateRestartDelayMillis_ / 1000.0);
                sendSystem(*requester,
                           "[UPDATE] Done. Server restarts in " + std::to_string(seconds) +
                               "s to load the new build (\"restart cancel\" or \"update cancel\" "
                               "to abort the restart -- the new files stay installed either "
                               "way).");
            } else {
                sendSystem(*requester,
                           "[UPDATE] Done. A restart is already firing -- the new build loads "
                           "when the server comes back up.");
            }
            break;
        }
        case autoupdate::Outcome::Failed:
            // The JS side already said what went wrong, through the log above.
            break;
        case autoupdate::Outcome::None:
            break;
    }

    if (!autoupdate::inProgress()) updateRequester_ = 0;
}

// ---------------------------------------------------------------------------
// The maze
// ---------------------------------------------------------------------------

std::string GameServer::adminChangeMaze(const std::string& argument) {
    static const std::array<const char*, 3> kBiomeNames = {{"garden", "desert", "ocean"}};
    const auto biomeName = [](MazeBiome biome) {
        return kBiomeNames[static_cast<std::size_t>(biome)];
    };

    const std::int64_t currentDay = activeMaze().day();
    const std::string token = lowerCase(trimmed(argument));

    std::int64_t targetDay = 0;
    if (token.empty() || token == "next") {
        targetDay = currentDay + 1;
    } else if (token == "garden" || token == "desert" || token == "ocean") {
        // The three layouts are authored, not generated: the day number only
        // picks which one is active, so asking for a biome means asking for the
        // nearest day that lands on it.
        const auto want = static_cast<std::int64_t>(
            token == "garden" ? 0 : (token == "desert" ? 1 : 2));
        const std::int64_t current = ((currentDay % 3) + 3) % 3;
        const std::int64_t advance = ((want - current) + 3) % 3;
        if (advance == 0) return "Maze is already " + token + ".";
        targetDay = currentDay + advance;
    } else {
        int parsed = 0;
        bool numeric = !token.empty();
        std::size_t at = (token[0] == '-') ? 1 : 0;
        if (at >= token.size()) numeric = false;
        for (std::size_t i = at; numeric && i < token.size(); ++i) {
            if (!std::isdigit(static_cast<unsigned char>(token[i]))) numeric = false;
        }
        if (!numeric) {
            return std::string("Usage: change-maze [next|garden|desert|ocean|<dayNumber>] ")
                       .append("\xE2\x80\x94 current: day ") +
                   std::to_string(currentDay) + " (" + biomeName(activeMaze().biome()) + ")";
        }
        parsed = std::atoi(token.c_str());
        targetDay = parsed;
    }

    if (targetDay == currentDay) {
        return "Maze is already day " + std::to_string(currentDay) + " (" +
               biomeName(activeMaze().biome()) + ").";
    }

    mazeDayOffset_ = targetDay - currentMazeDay();
    setActiveMazeDay(targetDay);

    // Anyone standing in the old layout is standing in the new one's walls.
    // The reference moves them to the new entrance; so does this, and the
    // client cuts its interpolation on the jump by itself. Yesterday's mobs
    // would be inside the walls too, so they go (clearMazeEnemies), and every
    // client is told which maze to build now.
    const Vec2 entrance = activeMaze().spawn();
    Query<PlayerTag, Transform> flowers{world_};
    std::vector<Entity> inside;
    flowers.each([&](Entity entity, PlayerTag&, Transform& transform) {
        if (transform.realm == Realm::Maze) inside.push_back(entity);
    });
    for (const Entity entity : inside) teleportEntity(entity, entrance);
    modes_->clearMaze(world_, commands_);
    broadcastMazeInfo();

    return "Maze changed to day " + std::to_string(activeMaze().day()) + " (" +
           biomeName(activeMaze().biome()) + "). Offset from real day: " +
           (mazeDayOffset_ >= 0 ? "+" : "") + std::to_string(mazeDayOffset_) + ".";
}

// ---------------------------------------------------------------------------
// Squads
// ---------------------------------------------------------------------------
//
// The rules are server/squads.h. What lives here is everything those rules
// deliberately know nothing about: which body a member currently owns, what to
// call them, and who to tell.

std::string GameServer::squadAccountName(SquadMemberId member) {
    if (!member.bot()) {
        const Session* session = sessionFor(member.connection);
        return session != nullptr && !session->username.empty() ? session->username : "Unknown";
    }
    // A bot has no account. The reference reads its "username" off its
    // nameplate for exactly this listing, and `/squad-invite` matches on the
    // same string, so the two agree by construction.
    if (const PlayerAccount* account = world_.tryGet<PlayerAccount>(member.entity)) {
        return account->username;
    }
    return "Unknown";
}

std::string GameServer::squadDisplayName(SquadMemberId member) {
    if (!member.bot()) {
        const Session* session = sessionFor(member.connection);
        if (session == nullptr) return "Unknown";
        return session->displayName.empty() ? session->username : session->displayName;
    }
    return squadAccountName(member);
}

Entity GameServer::squadEntity(SquadMemberId member) { return squadEntityOf(member); }

Entity GameServer::squadEntityOf(SquadMemberId member) const {
    if (member.bot()) {
        return world_.isAlive(member.entity) ? member.entity : NULL_ENTITY;
    }
    const auto it = sessions_.find(member.connection);
    if (it == sessions_.end() || !it->second.playing()) return NULL_ENTITY;
    return it->second.entity;
}

net::Connection* GameServer::squadConnection(SquadMemberId member) {
    return member.bot() ? nullptr : listener_.find(member.connection);
}

void GameServer::sendSquadUpdate(net::Connection& connection, const Squad* squad) {
    ByteWriter w;
    w.u8(static_cast<std::uint8_t>(net::ServerMessage::SquadUpdate));
    if (squad == nullptr) {
        w.boolean(false);
        connection.send(w);
        return;
    }
    w.boolean(true);
    w.str(squad->id);
    w.boolean(squad->isPublic);

    // A ROW PER BODY, not per member. A splitter's owner is one member with
    // two flowers, and the party HUD is a list of bars over bodies -- a member
    // that showed only the half being steered would leave the other one, the
    // one you cannot see because you are not looking through it, with no
    // health bar anywhere on the screen.
    std::vector<std::pair<SquadMemberId, Entity>> rows;
    rows.reserve(squad->members.size() + 1);
    for (const SquadMemberId& member : squad->members) {
        rows.emplace_back(member, squadEntity(member));
        if (member.bot()) continue;
        const auto found = sessions_.find(member.connection);
        if (found != sessions_.end() && found->second.split()) {
            rows.emplace_back(member, found->second.splitOther);
        }
    }

    w.u8(static_cast<std::uint8_t>(rows.size()));
    for (const auto& row : rows) {
        w.str(squadAccountName(row.first));
        w.str(squadDisplayName(row.first));
        // The wire id, not the entity: it is what the client's own world is
        // keyed by, and it is 0 for a member with no body just now -- somebody
        // sitting on the title screen, or waiting on a death card.
        const NetId* id = row.second != NULL_ENTITY ? world_.tryGet<NetId>(row.second) : nullptr;
        w.u32(id != nullptr ? id->value : 0);
        std::uint8_t flags = 0;
        // The leader mark rides the member's OWN row, which is the first one
        // it has: a flower does not lead a squad twice for being two flowers.
        if (squad->leader == row.first && row.second == squadEntity(row.first)) flags |= 1u;
        if (row.first.bot()) flags |= 2u;
        w.u8(flags);
    }
    connection.send(w);
}

void GameServer::broadcastSquadUpdate(const Squad& squad) {
    for (const SquadMemberId& member : squad.members) {
        if (net::Connection* peer = squadConnection(member)) sendSquadUpdate(*peer, &squad);
    }
}

void GameServer::sendSquadSystem(const Squad& squad, const std::string& text) {
    // Signed "[Squad]" rather than "System", which is what tells a member
    // whether a line was said to the world or to the four of them.
    for (const SquadMemberId& member : squad.members) {
        if (net::Connection* peer = squadConnection(member)) {
            sendChatTo(*peer, net::ChatChannel::Squad, "[Squad]",
                       "<span style=\"color: #4fc3f7;\">" + text + "</span>");
        }
    }
}

bool GameServer::resolveSquadTarget(const std::string& name, SquadMemberId& out) {
    if (Session* session = sessionForUser(name)) {
        out = squadIdOf(*session);
        return true;
    }
    // Then a bot, by nameplate: bots own no account, and inviting one is half
    // of what squads are for on a quiet server.
    const std::string key = lowerCase(trimmed(name));
    if (key.empty()) return false;
    for (const Bot& bot : bots_) {
        if (bot.entity == NULL_ENTITY || !world_.isAlive(bot.entity)) continue;
        if (lowerCase(bot.name) != key) continue;
        out = SquadMemberId::ofBot(bot.entity);
        return true;
    }
    return false;
}

void GameServer::departSquad(Session& session, net::Connection* connection,
                             const std::string& leaverName) {
    const SquadRoster::Departure departure = squads_.leave(squadIdOf(session));
    if (!departure.wasMember) return;
    if (connection != nullptr) sendSquadUpdate(*connection, nullptr);

    Squad* remaining = squads_.find(departure.squadId);
    if (remaining == nullptr) return;
    // Promotion first, then the departure: that is the order the reference
    // emits them in, because the promotion happens inside its leaveSquad and
    // the "has left" line is said by the caller afterwards.
    if (departure.promoted.valid()) {
        sendSquadSystem(*remaining, squadDisplayName(departure.promoted) +
                                        " is now the squad leader.");
    }
    sendSquadSystem(*remaining, leaverName + " has left the squad.");
    broadcastSquadUpdate(*remaining);
}

void GameServer::removeBotFromSquad(Entity body) {
    const SquadMemberId member = SquadMemberId::ofBot(body);
    if (squads_.forMember(member) == nullptr) return;
    // Read while the body is still alive: a destroyed bot has no nameplate to
    // put in the line its squad is about to be sent.
    const std::string name = squadDisplayName(member);
    const SquadRoster::Departure departure = squads_.leave(member);
    Squad* remaining = squads_.find(departure.squadId);
    if (remaining == nullptr) return;
    if (departure.promoted.valid()) {
        sendSquadSystem(*remaining, squadDisplayName(departure.promoted) +
                                        " is now the squad leader.");
    }
    sendSquadSystem(*remaining, name + " has left the squad.");
    broadcastSquadUpdate(*remaining);
}

// A squad is one party working ONE biome.
//
// The rules in server/squads.h know nothing about where anybody is standing,
// and should not: they are the membership rules, they are pure, and they are
// tested without a world. Where a member IS, though, is the one thing a squad
// must agree about -- the party HUD, the pink minimap dots and the shared loot
// ranking all describe people you are playing WITH, and a squadmate three
// biomes away is none of those things. So the biome test lives here, beside
// the bodies, and it is applied at every door into a squad and again whenever
// somebody arrives in a new biome.

std::string GameServer::squadMemberBiome(SquadMemberId member) const {
    if (member.bot()) return biomeOfEntity(member.entity);
    const auto it = sessions_.find(member.connection);
    if (it == sessions_.end()) return {};
    const Session& session = it->second;
    // A live body first, corpse included: a player on a death card is still
    // standing where they fell, and their squad is still the one there.
    if (session.entity != NULL_ENTITY && world_.isAlive(session.entity)) {
        const std::string biome = biomeOfEntity(session.entity);
        if (!biome.empty()) return biome;
    }
    // Nobody home: where their spawn choice is about to put them, which is
    // what the squad will have to live with the moment they press play.
    //
    // Only a choice they actually MADE, though. spawnRealmFor() answers the
    // overworld for a session that has picked nothing -- that is the door the
    // picker opens on, not a place the player has said they are going -- and
    // taking it at its word made every lobby a garden lobby: a flower in the
    // desert could invite nobody who was not already standing in the world,
    // while one in the garden could invite everybody, because everybody with
    // no body was "in the garden". Unknown is unknown, and unknown is no
    // objection; the arrival is caught by enforceSquadBiome when they press
    // play.
    if (session.spawnChoice.empty()) return {};
    return biomeOfRealm(spawnRealmFor(session));
}

std::string GameServer::squadBiome(const Squad& squad) const {
    // A member with a BODY first, the leader's if they have one: where the
    // squad actually is beats where somebody sitting on the title screen has
    // said they intend to go. Without that order a leader who backed out to
    // the picker and clicked a different door would redefine the squad's
    // biome from the menu and lock out the members still playing in it.
    const std::string leaders = biomeOfEntity(squadEntityOf(squad.leader));
    if (!leaders.empty()) return leaders;
    for (const SquadMemberId& member : squad.members) {
        const std::string biome = biomeOfEntity(squadEntityOf(member));
        if (!biome.empty()) return biome;
    }
    // Nobody is in the world: fall back to what they have chosen, so a party
    // formed on the title screen still cannot form across two doors.
    for (const SquadMemberId& member : squad.members) {
        const std::string biome = squadMemberBiome(member);
        if (!biome.empty()) return biome;
    }
    return {};
}

bool GameServer::squadAcceptsBiome(const Squad& squad, SquadMemberId who) const {
    const std::string theirs = squadMemberBiome(who);
    const std::string ours = squadBiome(squad);
    // An unknown biome is not a biome of its own: a member the world cannot
    // place yet is no reason to refuse a party that is otherwise legal.
    return theirs.empty() || ours.empty() || theirs == ours;
}

std::string GameServer::squadBiomeRefusal(const Squad& squad, SquadMemberId who,
                                          const std::string& whoLabel) const {
    if (squadAcceptsBiome(squad, who)) return {};
    return whoLabel + " in " + biomeLabel(squadMemberBiome(who)) + ", and the squad is in " +
           biomeLabel(squadBiome(squad)) + ". A squad cannot span biomes.";
}

void GameServer::enforceSquadBiome(SquadMemberId member) {
    Squad* squad = squads_.forMember(member);
    if (squad == nullptr) return;
    // Against the REST of the squad, not against squadBiome(): a leader who
    // walked out would otherwise redefine the squad's biome and throw
    // everybody else out of their own party instead of leaving it themselves.
    // BODIES only, on both sides. A member with no body has not gone
    // anywhere: they are on the title screen or on a death card, their door
    // is an intention rather than a place, and throwing somebody out of a
    // squad because a squadmate is browsing the picker is a bug the join-time
    // checks would never make.
    const std::string theirs = biomeOfEntity(squadEntityOf(member));
    if (theirs.empty()) return;
    std::string elsewhere;
    for (const SquadMemberId& other : squad->members) {
        if (other == member) continue;
        const std::string biome = biomeOfEntity(squadEntityOf(other));
        if (biome.empty()) continue;
        if (biome == theirs) return;   // somebody is still here: this is not the one who left
        if (elsewhere.empty()) elsewhere = biome;
    }
    // Read before the departure: leaving can disband the squad outright, and
    // the line telling somebody what they just left cannot be read off it
    // afterwards.
    if (elsewhere.empty()) return;

    const std::string name = squadDisplayName(member);
    if (member.bot()) {
        removeBotFromSquad(member.entity);
        return;
    }
    Session* session = sessionFor(member.connection);
    if (session == nullptr) return;
    net::Connection* connection = listener_.find(member.connection);
    departSquad(*session, connection, name);
    if (connection != nullptr) {
        sendNotice(*connection, net::NoticeSeverity::Warning,
                   "You left your squad by leaving " + biomeLabel(elsewhere) +
                       ". A squad cannot span biomes.");
    }
}

void GameServer::rebuildSquadIndex() {
    squadIndex_.clear();
    if (squads_.empty()) return;
    for (const auto& entry : squads_.all()) {
        std::vector<SquadBody> bodies;
        for (const SquadMemberId& member : entry.second.members) {
            const Entity body = squadEntity(member);
            if (body == NULL_ENTITY) continue;
            // A split member brings BOTH its flowers. They are one person --
            // contenderSize() in loot_eligibility.h counts them as one and
            // pays them one share -- and filing only the steered one would
            // leave the parked half ranking against its own owner as a
            // stranger, competing for the slots the corpse has.
            if (!member.bot()) {
                const auto found = sessions_.find(member.connection);
                if (found != sessions_.end() && found->second.split()) {
                    const PlayerAccount* other =
                        world_.tryGet<PlayerAccount>(found->second.splitOther);
                    bodies.push_back(SquadBody{found->second.splitOther,
                                               other != nullptr ? other->connection : 0});
                }
            }
            // BOTS INCLUDED. A bot is a member like any other here: its
            // damage pools into the squad's score and it counts in the
            // average, so a player squadded with bots is paid for what the
            // squad killed. What a bot does NOT get is a free share -- it
            // owns no account, so SquadBody::banks() is false and
            // loot_eligibility.h hands it nothing it did not earn. Leaving
            // bots out of the index entirely was worse in both directions:
            // it made a human-plus-bots squad rank as a solo player, which
            // on a quiet server is every squad there is.
            const PlayerAccount* account = world_.tryGet<PlayerAccount>(body);
            bodies.push_back(SquadBody{body, account != nullptr ? account->connection : 0});
        }
        // One body in the world is not a pool: leaving it out keeps the
        // ordinary case -- a squad whose other members are on the title screen
        // -- ranking exactly as a solo player does.
        if (bodies.size() < 2) continue;
        const std::size_t group = squadIndex_.groups.size();
        for (const SquadBody& member : bodies) squadIndex_.group[member.body] = group;
        squadIndex_.groups.push_back(std::move(bodies));
    }
}

Squad* GameServer::squadOrCreate(Session& session, net::Connection& connection) {
    const SquadMemberId me = squadIdOf(session);
    if (Squad* existing = squads_.forMember(me)) return existing;
    Squad* squad = squads_.create(me, false, rng_);
    // A squad made this way is announced nowhere else, so the client that
    // caused it would otherwise not know it exists.
    if (squad != nullptr) sendSquadUpdate(connection, squad);
    return squad;
}

void GameServer::collectSquadBodies(const Session& session, std::vector<Entity>& out) {
    out.clear();
    // A split flower's own other half, first and whatever else is true: it is
    // the one body on the map this client must never lose sight of, because
    // switching to it is one click away and a half that had scrolled off the
    // viewport would be switched into blind.
    if (session.split()) out.push_back(session.splitOther);
    const SquadMemberId me = squadIdOf(session);
    const Squad* squad = squads_.forMember(me);
    if (squad == nullptr) return;
    for (const SquadMemberId& member : squad->members) {
        if (member == me) continue;
        const Entity body = squadEntity(member);
        if (body != NULL_ENTITY) out.push_back(body);
    }
}

void GameServer::handleGuildSquadAll(Session& session, net::Connection& connection) {
    if (!session.authenticated()) return;
    const std::string guildName = guildNameForUser(session.username);
    if (guildName.empty()) {
        sendNotice(connection, net::NoticeSeverity::Warning, "You are not in a guild.");
        return;
    }
    // Before squadOrCreate, which would otherwise mint a squad for a flower
    // that is about to be told it may not have one.
    const std::string whileSplit = splitSquadRefusal(squadIdOf(session), "You are");
    if (!whileSplit.empty()) {
        sendNotice(connection, net::NoticeSeverity::Warning, whileSplit);
        return;
    }
    Squad* squad = squadOrCreate(session, connection);
    if (squad == nullptr || !(squad->leader == squadIdOf(session))) {
        sendNotice(connection, net::NoticeSeverity::Warning,
                   "Only your squad leader can invite guildmates into the squad.");
        return;
    }

    const Json& members = database_.storedTable("guilds")[guildName]["memberUsernames"];
    const auto now = static_cast<std::int64_t>(clockMillis_);
    int invited = 0;
    for (std::size_t i = 0; i < members.size(); ++i) {
        const std::string member = members[i].asString();
        if (lowerCase(member) == lowerCase(session.username)) continue;
        // +1 for the invitation already in flight this iteration: an invite is
        // a claim on a seat, and the reference stops one short for it.
        if (squad->members.size() + 1 >= kMaxSquadSize) break;
        Session* target = sessionForUser(member);
        if (target == nullptr) continue;
        // A guildmate farming another biome is not someone this squad can
        // take, so they are passed over rather than sent an invitation they
        // would be refused on.
        if (!squadAcceptsBiome(*squad, squadIdOf(*target))) continue;
        if (!squads_.invite(squadIdOf(session), squadIdOf(*target), session.username, now).empty()) {
            continue;
        }
        ++invited;
        if (net::Connection* peer = listener_.find(target->connection)) {
            sendSystem(*peer, "<span style=\"color: #4fc3f7;\">@" + session.username +
                                  " (guild) invited you to their squad. Use /squad-accept or "
                                  "/squad-decline.</span>");
        }
    }
    if (invited == 0) {
        sendNotice(connection, net::NoticeSeverity::Warning,
                   "No online guildmates available to invite (or squad is full).");
        return;
    }
    sendNotice(connection, net::NoticeSeverity::Good,
               "Sent squad invites to " + std::to_string(invited) + " online guildmate(s).");
}

void GameServer::handleGuildInviteToSquad(Session& session, net::Connection& connection,
                                          ByteReader& reader) {
    const std::string raw = reader.str();
    if (!reader.ok() || !session.authenticated()) return;
    guildInviteToSquad(session, connection, raw);
}

void GameServer::guildInviteToSquad(Session& session, net::Connection& connection,
                                    const std::string& raw) {
    if (!session.authenticated()) return;

    const std::string target = trimmed(raw);
    const std::string guildName = guildNameForUser(session.username);
    if (guildName.empty() ||
        guildMemberIndex(database_.storedTable("guilds")[guildName], target) < 0) {
        sendNotice(connection, net::NoticeSeverity::Warning, target + " is not in your guild.");
        return;
    }
    Session* peerSession = sessionForUser(target);
    if (peerSession == nullptr) {
        sendNotice(connection, net::NoticeSeverity::Warning, target + " is offline.");
        return;
    }
    const std::string whileSplit =
        splitSquadRefusal(squadIdOf(session), "You are") +
        splitSquadRefusal(squadIdOf(*peerSession), target + " is");
    if (!whileSplit.empty()) {
        sendNotice(connection, net::NoticeSeverity::Warning, whileSplit);
        return;
    }
    Squad* squad = squadOrCreate(session, connection);
    if (squad == nullptr) {
        sendNotice(connection, net::NoticeSeverity::Warning, "Failed to create a squad.");
        return;
    }
    const std::string wrongBiome =
        squadBiomeRefusal(*squad, squadIdOf(*peerSession), target + " is");
    if (!wrongBiome.empty()) {
        sendNotice(connection, net::NoticeSeverity::Warning, wrongBiome);
        return;
    }
    const std::string error =
        squads_.invite(squadIdOf(session), squadIdOf(*peerSession), session.username,
                       static_cast<std::int64_t>(clockMillis_));
    if (!error.empty()) {
        sendNotice(connection, net::NoticeSeverity::Warning, error);
        return;
    }
    sendNotice(connection, net::NoticeSeverity::Good, "Squad invite sent to " + target + ".");
    if (net::Connection* peer = listener_.find(peerSession->connection)) {
        sendSystem(*peer, "<span style=\"color: #4fc3f7;\">@" + session.username +
                              " (guild) invited you to their squad. Use /squad-accept or "
                              "/squad-decline.</span>");
    }
}

void GameServer::handleRespawn(Session& session) {
    if (!session.authenticated()) return;
    // A lent console is lent for one life. Dropping it here rather than on
    // death means the grantee keeps it while they are looking at the death
    // card, which is where the reference leaves it too.
    revokeTempAdmin(session.connection);
    // The map the client is still drawing. A corpse keeps its realm until it
    // is replaced, so this is what the client last heard; a session with no
    // body has told its client nothing since the join, and is restated
    // regardless.
    bool corpseRealmKnown = false;
    Realm corpseRealm = Realm::Overworld;
    if (session.playing() && world_.isAlive(session.entity)) {
        Health* health = world_.tryGet<Health>(session.entity);
        if (health && health->alive()) return;   // not actually dead
        if (const Transform* corpse = world_.tryGet<Transform>(session.entity)) {
            corpseRealmKnown = true;
            corpseRealm = corpse->realm;
        }
        despawnPlayer(session, false);
    }
    const Entity reborn = spawnPlayer(session);
    // A flower that died in a map it teleported into comes back where its
    // spawn choice says -- usually another map. The snapshot stream restates
    // the body but never the realm, so the client would keep drawing the map
    // it died on under a body standing somewhere else: the same message a
    // pad sends, for the same reason.
    if (reborn != NULL_ENTITY) {
        const Transform* transform = world_.tryGet<Transform>(reborn);
        if (transform != nullptr && (!corpseRealmKnown || transform->realm != corpseRealm)) {
            sendRealmChange(session, transform->position);
        }
    }
    // A fresh arena run has a fresh kit; the same restatement the join makes.
    if (net::Connection* connection = listener_.find(session.connection)) {
        sendProfile(session, *connection);
    }
}

void GameServer::handlePing(net::Connection& connection, ByteReader& reader) {
    const std::uint64_t clientTime = reader.u64();
    if (!reader.ok()) return;
    ByteWriter w;
    w.u8(static_cast<std::uint8_t>(net::ServerMessage::Pong));
    w.u64(clientTime);
    w.u64(static_cast<std::uint64_t>(monotonicMillis()));
    connection.send(w);
}

// ---------------------------------------------------------------------------
// Bots
// ---------------------------------------------------------------------------
//
// The reference keeps the world populated whether or not anyone else is
// online: it tops the flower count up to ~23 with server-owned players that
// hunt, wander, die and respawn. Without them a solo player meets an empty
// map -- no company, no competition for aggro or loot, and a leaderboard with
// one row on it.
//
// A bot here is an ORDINARY player entity with no Session behind it. That is
// the whole trick: combat, loot eligibility, replication and the death reaper
// all treat it as a flower without knowing bots exist, and the handful of
// places that need an account (banking a kill, a pickup, a persist) already
// walk the session table and simply find nothing.
//
// What lives here is the POPULATION: the target, the jitter, the burst cap,
// idle retirement, and the name-seeded level and loadout. What a bot DOES --
// sensing, hunting grounds, and the activity machine over them -- is
// server/bot_ai.cpp, whose header explains the shape.


// ---------------------------------------------------------------------------
// Player lifecycle
// ---------------------------------------------------------------------------

void GameServer::collectSpawnBlockers(Realm realm, std::vector<MobDisc>& out) const {
    out.clear();
    Query<MobTag, Transform, Body> mobs{const_cast<World&>(world_)};
    mobs.each([&](Entity, MobTag&, Transform& transform, Body& body) {
        if (transform.realm != realm) return;
        out.push_back({transform.position, body.radius});
    });
}

void GameServer::onPlayerRevived(Entity revived, Entity reviver) {
    Session* session = sessionForEntity(revived);
    if (session == nullptr) return;

    // The corpse's death has already been announced and the reaper has stopped
    // looking at it. Clearing the flag is what lets this body die a second
    // time: without it the next death is silent and the player is left standing
    // as a corpse nobody told them about.
    session->deathReported = false;
    net::Connection* connection = listener_.find(session->connection);
    if (connection == nullptr) return;

    // Whoever carried the yggdrasil, by the name on their nameplate -- a bot's
    // reads the same way a player's does. A reviver whose own body went away
    // between the raise and this call leaves the client its own fallback.
    std::string reviverName;
    if (reviver != NULL_ENTITY && world_.isAlive(reviver)) {
        if (const PlayerAccount* account = world_.tryGet<PlayerAccount>(reviver)) {
            reviverName = account->username;
        }
    }

    // The counterpart of the `Died` the reaper sent: without it the client
    // keeps the death card up and stops sending input, so a revived player
    // stands in the world unable to move.
    ByteWriter w;
    w.u8(static_cast<std::uint8_t>(net::ServerMessage::Revived));
    w.str(reviverName);
    connection->send(w);
}

Entity GameServer::spawnPlayer(Session& session) {
    // Where a player appears is a property of the MAP, not of the player.
    // Level deliberately does not enter into it: picking a zone by tier reads
    // as if a high-level flower should start in high-tier ground, and what it
    // actually does is drop everyone into the mythic band in the middle of the
    // world, which nothing can walk out of.
    // The candidate has to be clear of the mobs standing on it, not only of
    // the walls: the reference refuses a spawn point that overlaps a body or
    // that has more than a handful of mobs within 200 units, which is what
    // stops a fresh flower materialising inside a swarm.
    const Realm realm = spawnRealmFor(session);
    Vec2 spawn;
    if (realm == Realm::Arena) {
        spawn = kArenaSpawn;
    } else if (realm == Realm::Maze) {
        // Inside the entrance room, jittered so a party does not stack on one
        // point (src/server/playerManager.ts:168-179), and on floor whatever
        // the jitter did.
        spawn = terrain_->findOpenSpawn(rng_, activeMaze().spawn(), kMazeCellSize * 0.3, realm);
    } else {
        std::vector<MobDisc> blockers;
        collectSpawnBlockers(realm, blockers);
        const SpawnChoice* choice = chosenDoor(session);
        const MapData* map = worldMaps_.forRealm(realm);
        // The chosen rectangle first; its own map's default when the rectangle
        // is walled over or crowded; the overworld's default when the player
        // chose nothing at all.
        if (choice == nullptr || map == nullptr ||
            !map->spawnAt(worldMaps_.maps()[static_cast<std::size_t>(worldMapSlot(realm))]
                              .elements()[static_cast<std::size_t>(choice->element)]
                              .spawnId,
                          rng_, *terrain_, spawn, &blockers)) {
            const MapData* fallback = map != nullptr ? map : worldMaps_.forRealm(Realm::Overworld);
            spawn = fallback != nullptr ? fallback->defaultSpawn(rng_, *terrain_, &blockers)
                                        : terrain_->spawnPoint(realm);
        }
    }

    // The realm is settled on the session BEFORE the account is applied, and
    // the arena's scratch record with it: applyAccountToEntity reads both.
    session.realm = realm;
    session.arena.reset();
    if (realm == Realm::Arena) session.arena = startArenaRun(database_.progress(session.userId));

    const Entity entity = createPlayerBody(session, realm, spawn);

    // A FRESH body only: full health and the respawn window. createPlayerBody
    // must never do either -- a splitter's second body is built by it too, and
    // it inherits what the flower it was cut from was carrying.
    Health& health = world_.get<Health>(entity);
    health.current = health.max;
    health.invulnerableUntilMillis = monotonicMillis() + kRespawnInvulnerabilitySeconds * 1000.0;

    session.entity = entity;
    session.stage = SessionStage::Playing;
    // A fresh body has a death of its own still to announce.
    session.deathReported = false;
    // And a fresh life owes nothing to the last one's losses: a splitter on
    // the bar cuts this body in two on the next tick.
    session.splitReadyAtMillis = 0;
    // A player picks their door on the title screen, and a squad they joined
    // before going back to it is a squad they may now be standing three
    // biomes away from. This is the hole the join-time checks cannot close,
    // because nothing about the join goes through them.
    enforceSquadBiome(squadIdOf(session));
    // The roster carries WIRE IDS, and this player just acquired a new one.
    // Without this a squadmate's dot and party bar stay pinned to the body
    // they had before they died.
    if (const Squad* squad = squads_.forMember(squadIdOf(session))) broadcastSquadUpdate(*squad);
    return entity;
}

Entity GameServer::createPlayerBody(Session& session, Realm realm, Vec2 spawn) {
    const Entity entity = world_.create();
    world_.add<PlayerTag>(entity);
    world_.add<Transform>(entity, Transform{spawn, 0.0, realm});
    world_.add<Motion>(entity);
    world_.add<Knockback>(entity);
    // In the ring players are hostile to each other; everywhere else they are
    // not. Petals and pets copy this Faction, so the whole kit follows.
    world_.add<Faction>(entity, Faction{Team::Players, realm == Realm::Arena});
    if (realm == Realm::Arena) world_.add<ArenaScore>(entity);
    world_.add<PlayerInput>(entity);
    world_.add<PlayerLocation>(entity);
    world_.add<PlayerModifiers>(entity);
    world_.add<PlayerVisuals>(entity);
    world_.add<PlayerSkillTree>(entity);
    world_.add<Loadout>(entity);
    world_.add<PetalRing>(entity);
    // A flower's body damages mobs on contact in the TypeScript server. The
    // zero interval means every separated re-contact may land; the fixed
    // 25-unit bump normally prevents it from becoming a per-tick damage beam.
    world_.add<ContactDamage>(entity, ContactDamage{kPlayerBaseDamage, 0.0});
    world_.add<HitCooldowns>(entity);
    world_.add<Afflictions>(entity);
    world_.add<ShieldState>(entity);
    // The nameplate carries the flower's name, which is what the title screen
    // asked for; the account name stays on the session for chat and for saves.
    world_.add<PlayerAccount>(entity,
                              PlayerAccount{session.userId,
                                            session.displayName.empty() ? session.username
                                                                        : session.displayName,
                                            session.connection, session.admin});

    const PlayerRecord& record = liveRecord(session);
    applyAccountToEntity(record, entity);

    world_.add<NetId>(entity, NetId{netIds_.next()});
    Replicated replicated;
    replicated.kind = net::EntityKind::Player;
    world_.add<Replicated>(entity, replicated);

    // A name per BODY, not per connection: a split flower has two, and giving
    // them the same handle would let the second quietly replace the first in
    // the world's name table.
    world_.bindName(entity, "conn:" + std::to_string(session.connection) +
                                (session.entity == NULL_ENTITY ? "" : ":split"));
    return entity;
}

void GameServer::applyAccountToEntity(const PlayerRecord& record, Entity entity) {
    // Which realm the body is in decides which of the account's tracks it
    // plays on: the maze has its own XP and its own tree
    // (src/server/playerManager.ts:198-245), and the ring has a flat health
    // pool with talents switched off (src/server/playerManager.ts:812-824).
    const Transform* transform = world_.tryGet<Transform>(entity);
    const Realm realm = transform != nullptr ? transform->realm : Realm::Overworld;
    const bool maze = realm == Realm::Maze;
    const double trackXp = maze ? record.mazeTotalXp : record.totalXp;
    const SkillSet& skills = maze ? record.mazeSkills : record.skills;
    const LevelProgress progress = levelFromTotalXp(trackXp);

    PlayerProgress& state = world_.ensure<PlayerProgress>(entity);
    state.totalXp = trackXp;
    state.level = progress.level;
    state.stars = record.stars;

    // Cosmetic skin bits are account data, and so is the worn custom skin --
    // the body is rebuilt on every respawn, so without this line a player who
    // dies comes back a plain flower. The temporary glitch bit stays on
    // PlayerVisuals and is intentionally not reset by a loadout edit.
    PlayerVisuals& cosmetics = world_.ensure<PlayerVisuals>(entity);
    cosmetics.renderFlags = record.renderFlags;
    cosmetics.equippedSkinId = record.equippedSkinId;

    // The tree is copied onto the body so the tick never reaches into storage.
    // Every path that changes it -- login, respawn, buying a tier, a reset --
    // comes back through here, which is what keeps the two in step.
    world_.ensure<PlayerSkillTree>(entity).skills = skills;

    Body& body = world_.ensure<Body>(entity);
    body.radius = playerRadiusForLevel(progress.level);
    body.mass = 1.0;

    Health& health = world_.ensure<Health>(entity);
    const double previousFraction = health.max > 0 ? health.current / health.max : 1.0;
    health.max = realm == Realm::Arena
                     ? kArenaMaxHealth
                     : maxHealthForLevel(progress.level) * skills.statScale(SkillId::PlayerHealth);
    // Preserve the FRACTION across a max-health change, so levelling up mid
    // fight neither heals you to full nor leaves you proportionally worse off.
    //
    // Clamped DOWNWARD only. This function also runs on every loadout edit and
    // every talent purchase, including ones sent from the death screen -- the
    // client keeps its panels live there and a corpse keeps its session. A
    // rescue that read "empty means full" would refill a dead flower's health
    // bar in front of everyone watching it, and arming respawn protection here
    // would hand out three seconds of immunity for the price of swapping two
    // empty loadout slots, over and over. Both belong to a fresh body, so both
    // live in spawnPlayer.
    health.current = clamp(health.max * clamp(previousFraction, 0.0, 1.0), 0.0, health.max);

    world_.ensure<ContactDamage>(entity).amount = bodyDamageForLevel(progress.level);
    world_.get<ContactDamage>(entity).intervalMillis = 0.0;

    Loadout& loadout = world_.ensure<Loadout>(entity);
    for (std::size_t i = 0; i < kLoadoutSlots; ++i) {
        const WornSlot worn = wornSlot(record, i, realm);
        loadout.slots[i].configIndex = worn.petalIndex;
        loadout.slots[i].rarity = worn.rarity;
        // `broken` and `reloadReadyAtMillis` are deliberately NOT touched. They
        // are the ring's own bookkeeping: the petal pass arms a full reload on
        // any slot whose contents changed and leaves an unchanged one alone, so
        // clearing them here would wipe the timer of a slot the player did not
        // touch, and would make re-equipping the same petal over one that just
        // broke a way to dodge its reload entirely.
    }
}

void GameServer::applyAccountToSession(Session& session) {
    const PlayerRecord& record = liveRecord(session);
    for (const Entity body : bodiesOf(session)) {
        if (body != NULL_ENTITY && world_.isAlive(body)) applyAccountToEntity(record, body);
    }
}

void GameServer::persistPlayer(const Session& session) {
    if (!session.playing() || !world_.isAlive(session.entity)) return;
    const PlayerProgress* progress = world_.tryGet<PlayerProgress>(session.entity);
    if (!progress) return;

    PlayerRecord& record = database_.progress(session.userId);
    // Onto the track the body was playing on: a maze run's XP is the maze's,
    // and writing it into totalXP would destroy the outside level
    // (src/server/playerManager.ts:975-978).
    if (session.realm == Realm::Maze) record.mazeTotalXp = progress->totalXp;
    else record.totalXp = progress->totalXp;
    record.stars = progress->stars;
    database_.markDirty();
}

void GameServer::despawnPlayer(Session& session, bool persist) {
    if (session.entity == NULL_ENTITY) return;
    // The other half first, and with no reload armed: the body it would have
    // been armed on is about to be destroyed as well, and the split is ending
    // because the PLAYER is leaving, not because a flower was lost.
    endSplit(session, clockMillis_, false);
    if (persist) persistPlayer(session);
    // Leaving the ring, by any door, is the end of the run.
    if (session.arena) endArenaRun(session);
    session.realm = Realm::Overworld;

    // The petals and pets belong to the body, not the account, so they go
    // with it.
    destroyBody(session.entity);

    session.entity = NULL_ENTITY;
    session.stage = SessionStage::Authenticated;
    views_[session.connection].reset();
    // Same reason as the spawn: the id this member was known by is gone, and a
    // roster still naming it points every squadmate's HUD at nothing.
    if (const Squad* squad = squads_.forMember(squadIdOf(session))) broadcastSquadUpdate(*squad);
}

void GameServer::destroyBody(Entity body) {
    if (body == NULL_ENTITY || !world_.isAlive(body)) return;
    // The ring is on the Loadout; the pets are on the SLOT STATE, and the only
    // other thing that ever walks those is the ring pass recalling a downed
    // flower's summons (PetalSystem::clearRing). A body destroyed while it was
    // standing is never down, so without this its pets outlived it with a
    // dangling owner -- and an ownerless pet wanders for good.
    //
    // Destroyed, not killed, exactly as a recall does it: nothing dies here,
    // so nothing raises a death event or drops anything. A handle the world
    // already reaped is harmless: handles are generational.
    if (const Loadout* loadout = world_.tryGet<Loadout>(body)) {
        for (const Entity petal : loadout->spawned) commands_.destroy(petal);
    }
    if (const PetalSlotState* state = world_.tryGet<PetalSlotState>(body)) {
        for (const PetalSlotState::Slot& slot : state->slots) {
            for (const Entity pet : slot.pets) commands_.destroy(pet);
        }
    }
    commands_.destroy(body);
}

// ---------------------------------------------------------------------------
// Realms: the arena run and the maze track
// ---------------------------------------------------------------------------

void GameServer::moveEntityToRealm(Entity entity, Realm realm, Vec2 position) {
    if (!world_.isAlive(entity)) return;
    Transform* transform = world_.tryGet<Transform>(entity);
    if (transform == nullptr) return;
    if (transform->realm == realm && distanceSq(transform->position, position) < 1.0) return;

    const Realm from = transform->realm;
    const bool sameRealm = from == realm;
    transform->realm = realm;
    transform->position = position;
    // Velocity and knockback describe where the body WAS going, in a space it
    // is no longer in. A flower that arrives still carrying the impulse that
    // pushed it onto the pad arrives sliding.
    if (Motion* motion = world_.tryGet<Motion>(entity)) motion->velocity = {0, 0};
    if (Knockback* knockback = world_.tryGet<Knockback>(entity)) knockback->impulse = {0, 0};
    // A pad the flower is standing on at the far end must not grab it back on
    // the very next tick, and its charge-up belongs to the map it was on.
    if (TeleporterState* pads = world_.tryGet<TeleporterState>(entity)) {
        pads->pad = -1;
        pads->enteredAtMillis = 0;
        pads->cooldownUntilMillis = clockMillis_ + kTeleporterCooldownMillis;
    }

    // A pad that leads somewhere on the SAME map is a jump, not a move
    // between worlds: the grid under the body has not changed, so there is
    // nothing to send and nothing to clear. The kit is re-placed around the
    // ring by its own system, and the client's snap-distance rule cuts the
    // interpolation on its own, exactly as it does for teleportEntity().
    if (sameRealm) return;

    // The kit comes too. A petal or a pet left behind in the old realm is not
    // merely invisible: it is in another coordinate space, so it never reaches
    // its owner's ring again, it is streamed to nobody, and it goes on
    // colliding with whatever it was left standing next to.
    //
    // One pass over the world rather than a per-owner index, because this runs
    // when somebody takes a teleporter and not per tick.
    Query<Transform> everything{world_};
    everything.each([&](Entity other, Transform& at) {
        if (other == entity) return;
        if (at.realm != from) return;
        Entity owner = NULL_ENTITY;
        if (const PetalInstance* petal = world_.tryGet<PetalInstance>(other)) owner = petal->owner;
        else if (const Pet* pet = world_.tryGet<Pet>(other)) owner = pet->owner;
        else if (const Projectile* shot = world_.tryGet<Projectile>(other)) owner = shot->creditTo;
        if (owner != entity) return;
        at.realm = realm;
        // Petals are re-placed around the ring by their own system on the next
        // tick; putting them on the flower now keeps them out of whatever the
        // destination has at their old coordinates in the meantime.
        at.position = position;
    });

    // The client has no map file: it has to be SENT the destination's grid, or
    // it draws the map it arrived from underneath a body standing somewhere
    // else entirely.
    Session* session = sessionForEntity(entity);
    if (session == nullptr) {
        // A bot: nothing to tell, but a bot in a squad has still just walked
        // out of the biome the rest of it is working.
        if (botForEntity(entity) != nullptr) enforceSquadBiome(SquadMemberId::ofBot(entity));
        return;
    }
    session->realm = realm;
    sendRealmChange(*session, position);
    enforceSquadBiome(squadIdOf(*session));
}

void GameServer::sendRealmChange(Session& session, Vec2 position) {
    views_[session.connection].reset();
    net::Connection* connection = listener_.find(session.connection);
    if (connection == nullptr) return;
    ByteWriter w;
    w.u8(static_cast<std::uint8_t>(net::ServerMessage::RealmChange));
    w.position(position);
    writeMapGrid(w, *terrain_, session.realm);
    connection->send(w);
}

std::string GameServer::biomeOfRealm(Realm realm) const {
    // The two generated realms answer with the picker ids they are asked for
    // by name, so a ring party and a maze party are each one biome rather
    // than sharing the nameless bucket every unstaged realm would fall into.
    if (realm == Realm::Arena) return kArenaSpawnChoice;
    if (realm == Realm::Maze) return kMazeSpawnChoice;
    const MapData* map = worldMaps_.forRealm(realm);
    return map != nullptr ? map->biome() : std::string();
}

std::string GameServer::biomeLabel(const std::string& biome) const {
    if (biome.empty()) return biome;
    for (const SpawnChoice& choice : worldMaps_.spawnChoices()) {
        if (biomeOfRealm(choice.realm) == biome) return choice.label;
    }
    if (biome == kArenaSpawnChoice) return "PVP Arena";
    if (biome == kMazeSpawnChoice) return "Maze";
    return biome;
}

std::string GameServer::biomeOfEntity(Entity entity) const {
    if (entity == NULL_ENTITY || !world_.isAlive(entity)) return {};
    const Transform* transform = world_.tryGet<Transform>(entity);
    return transform != nullptr ? biomeOfRealm(transform->realm) : std::string();
}

const SpawnChoice* GameServer::chosenDoor(const Session& session) const {
    const SpawnChoice* door = worldMaps_.door(session.spawnChoice);
    if (door == nullptr) return nullptr;
    // Checked on every body, not only at the join: a lent console is lent
    // for one life, and a non-pickable door named on it is not kept past it.
    if (!door->pickable && !session.admin) return nullptr;
    return door;
}

Realm GameServer::spawnRealmFor(const Session& session) const {
    if (session.spawnChoice == kArenaSpawnChoice) return Realm::Arena;
    if (session.spawnChoice == kMazeSpawnChoice) return Realm::Maze;
    // A spawn point carries the map it is on, so choosing one is how a player
    // joins straight into a map other than the overworld.
    const SpawnChoice* choice = chosenDoor(session);
    return choice != nullptr ? choice->realm : Realm::Overworld;
}

PlayerRecord& GameServer::liveRecord(Session& session) {
    if (session.arena) return *session.arena;
    return database_.progress(session.userId);
}

std::unique_ptr<PlayerRecord> GameServer::startArenaRun(const PlayerRecord& account) const {
    // The reference's enterPvpArena: five common basics and five empty slots,
    // nothing in the bag, and a fresh score. The level is the account's -- XP
    // keeps accruing in the ring -- and so are the cosmetics. No talents: the
    // ring switches every multiplier off, so the scratch tree stays empty.
    auto run = std::make_unique<PlayerRecord>();
    run->totalXp = account.totalXp;
    run->stars = account.stars;
    run->renderFlags = account.renderFlags;
    run->equippedSkinId = account.equippedSkinId;
    run->loadout.assign(kLoadoutSlots, std::nullopt);
    const std::uint16_t basic = content().petalIndex("basic");
    if (basic != kInvalidIndex) {
        for (std::size_t i = 0; i < 5 && i < kLoadoutActiveSlots; ++i) {
            StoredItem item;
            item.type = "petal";
            item.petalType = content().petal(basic).id;
            item.rarity = Rarity::Common;
            run->loadout[i] = item;
        }
    }
    return run;
}

void GameServer::endArenaRun(Session& session) {
    if (!session.arena) return;
    PlayerRecord& account = database_.progress(session.userId);
    // A quarter of every stack looted in the ring, rounded down, reaches the
    // account (exitPvpArena); the ring's own petals and whatever was equipped
    // out of its bag do not.
    const Json& bag = session.arena->inventory;
    for (const std::string& rarityName : bag.keys()) {
        const Rarity rarity = parseRarity(rarityName);
        const Json& byType = bag[rarityName];
        for (const std::string& key : byType.keys()) {
            const int kept = static_cast<int>(
                std::floor(std::max(0, byType[key].asInt()) * kArenaInventoryKeepRatio));
            if (kept <= 0) continue;
            account.addItem(rarity, key, kept);
        }
    }
    session.arena.reset();
    database_.markDirty();
}

void GameServer::settleArenaDeath(Session& victim, Entity killer) {
    if (!victim.arena) return;
    Session* winner = killer != NULL_ENTITY ? sessionForEntity(killer) : nullptr;
    // Only another flower IN THE RING inherits anything: a mob kill, a bot, or
    // a killer who has since left simply empties the run (playerState.ts:1352).
    if (winner != nullptr && winner != &victim && winner->arena && winner->playing()) {
        if (ArenaScore* mine = world_.tryGet<ArenaScore>(victim.entity)) {
            if (ArenaScore* theirs = world_.tryGet<ArenaScore>(winner->entity)) {
                theirs->score += mine->score;
            }
        }
        const Json& bag = victim.arena->inventory;
        for (const std::string& rarityName : bag.keys()) {
            const Rarity rarity = parseRarity(rarityName);
            const Json& byType = bag[rarityName];
            for (const std::string& key : byType.keys()) {
                const int count = std::max(0, byType[key].asInt());
                if (count > 0) winner->arena->addItem(rarity, key, count);
            }
        }
        if (net::Connection* connection = listener_.find(winner->connection)) {
            sendProfile(*winner, *connection);
        }
    }
    if (ArenaScore* mine = world_.tryGet<ArenaScore>(victim.entity)) mine->score = 0;
    victim.arena->inventory = Json::object();
    if (net::Connection* connection = listener_.find(victim.connection)) {
        sendProfile(victim, *connection);
    }
}

void GameServer::sendMazeInfo(net::Connection& connection) {
    ByteWriter w;
    w.u8(static_cast<std::uint8_t>(net::ServerMessage::MazeInfo));
    w.i64(activeMaze().day());
    connection.send(w);
}

void GameServer::broadcastMazeInfo() {
    for (auto& entry : sessions_) {
        if (!entry.second.authenticated()) continue;
        if (net::Connection* connection = listener_.find(entry.second.connection)) {
            sendMazeInfo(*connection);
        }
    }
}

} // namespace flix
