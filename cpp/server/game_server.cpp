// GameServer's core: start-up, the fixed-rate tick and the order the systems
// run in, the reaper, replication and the tick's own timing.
//
// The class is split across these files by area:
//   game_server.cpp      this file
//   connections.cpp      sessions, the handshake, and the switch that bills
//                        each client message and hands it to its handler
//   accounts.cpp         register, guest, login, resume, password, username,
//                        logout, the one-session rule
//   profile.cpp          the Profile, its deltas and the ProfileCheck digest
//   players.cpp          join, leave, input, respawn; building, saving and
//                        removing a flower's body
//   realms.cpp           realm changes, biomes, spawn doors, the arena run,
//                        the maze
//   chat.cpp             Global and Local chat, screening, the backlog
//   chat_commands.cpp    everything typed with a leading '/'
//   loadout.cpp          equipping, swapping and saved presets
//   crafting.cpp         crafting, and the oracle, trader, assembler and titan
//   rewards.cpp          banking pickups and kills; boss and rare-find lines
//   talents.cpp          buying and resetting talents
//   shop.cpp             the star shop and star codes
//   skins.cpp            the custom skin catalogue, votes and favourites
//   leaderboard.cpp      the leaderboard
//   notifications.cpp    the global notification feed
//   guild_service.cpp    guilds, their rosters, squads raised from a guild
//   squad_service.cpp    squads in the world: bodies, names, biomes
//   restart.cpp          scheduled restarts and the self-update
//   admin_cursor.cpp     the admin Cursor: phase, grab, drag, kill, teleport
//   admin_dashboard.cpp, admin_db.cpp, admin_tools.cpp, admin_arena.cpp,
//   polls.cpp, market.cpp
//                        the admin panels, hosted events, polls, the market
//   bot_ai.cpp           the bots
//   splitter.cpp, sacrifice.cpp, waves.cpp
//                        the splitter, the sacrifice petal, waves mode
//   inventory.cpp        the bag and the worn ring as the database keeps them
// and game_server_internal.h holds the helpers more than one of them uses.

#include "server/game_server.h"

#include <algorithm>
#include <cmath>
#include <cstdio>
#include <cstring>
#include <vector>

#include "shared/core/process_stats.h"
#include "server/admin_db_key.h"
#include "server/systems/combat.h"
#include "server/systems/dungeons.h"
#include "server/systems/loot.h"
#include "server/systems/mob_ai.h"
#include "server/systems/mode_spawning.h"
#include "server/systems/movement.h"
#include "server/systems/npcs.h"
#include "server/systems/petals.h"
#include "server/systems/spawning.h"
#include "server/game_server_internal.h"
#include "shared/game/config.h"
#include "shared/game/content_report.h"

namespace flix {

namespace {

/// How often account progress is written back from the live entity.
constexpr double kPersistIntervalMillis = 30000.0;

/// Ceiling on one simulation step, as a multiple of the nominal one. A long
/// stall must not be paid back as a single giant integration step that walks
/// every flower through a wall.
constexpr double kMaxDeltaSeconds = net::kTickSeconds * 3.0;

/// Low-pass factor on the step, ~a ten-tick time constant.
constexpr double kDeltaSmoothing = 0.1;

/// A tick this long gets its phase split logged. Three nominal ticks: a
/// healthy tick is a few milliseconds, and one this long is a visible hitch.
constexpr double kSlowTickLogMillis = net::kTickMillis * 3.0;

/// "Legendary Soldier Ant": the killer's tier and its display name.
///
/// The name, not the config id: the browser client built this from the id, so
/// `baby_ant` read "Common Baby_ant", but ids are for commands and internals
/// and never shown to a player. A player killer reads "Common Player", as it
/// did there. An empty string means
/// the killer is unknown, which is what leaves the client on its own fallback
/// wording.
std::string killerLabel(const World& world, Entity killer) {
    if (killer == NULL_ENTITY || !world.isAlive(killer)) return {};
    if (world.has<PlayerTag>(killer)) return "Common Player";
    const MobType* type = world.tryGet<MobType>(killer);
    if (type == nullptr) return {};
    const std::string& name = content().mob(type->configIndex).name;
    if (name.empty()) return {};
    return std::string(rarityLabel(type->rarity)) + " " + name;
}

/// Refills the broadphase with every body as it stands now.
///
/// Every body but the projectiles, which combat files in a broadphase of its
/// own (CombatSystem::fileShots): nothing else that asks this grid wants a
/// shot, and a flower on a full loadout of gas would otherwise put a thousand
/// of them into every aggro scan and pickup query around it.
///
/// Nor an intangible mob: what nothing may touch is simply not in the grid
/// anything touches through, so no contact, petal, aura, strike, pet or bot
/// ever finds it to ask.
void fileBodies(World& world, SpatialGrid& grid) {
    grid.clear();
    Query<Transform, Body> bodies{world};
    bodies.without<ProjectileTag, Intangible>();
    bodies.each([&](Entity e, Transform& transform, Body& body) {
        grid.insert(e, transform.realm, transform.position, body.radius);
    });
}

} // namespace

double monotonicMillis() {
    using clock = std::chrono::steady_clock;
    static const clock::time_point start = clock::now();
    return std::chrono::duration<double, std::milli>(clock::now() - start).count();
}

GameServer::GameServer() = default;

GameServer::~GameServer() = default;

std::string GameServer::adminDbKey() const {
    if (!config_.fixedAdminDbKey.empty()) return config_.fixedAdminDbKey;
    std::string key;
    std::string error;
    return admin_db::readKeyFile(adminDbKeyPath_, key, error) ? key : std::string();
}

bool GameServer::start(const ServerConfig& config, std::string& errorOut) {
    config_ = config;
    // The configured bot population, if the caller named one. Same field
    // `/admin set_bot_count` writes, so the two cannot disagree.
    botCountOverride_ = config.botCount;

    if (!loadContent(config.dataDir, errorOut)) return false;
    for (const std::string& warning : content().warnings()) {
        contentWarning("[content] %s\n", warning.c_str());
    }

    // A database that exists but will not parse is fatal at startup. Coming up
    // with an empty one would serve every returning player a blank account and,
    // worse, save that over the file they still had.
    if (!database_.load(config.databasePath, errorOut)) return false;
    if (config.passwordCost > 0) database_.setPasswordCost(config.passwordCost);
    foldLookAlikeSkins();

    // Kept in a file beside the database, never anywhere a client can reach:
    // reading it is what proves an admin also has the machine. A first start
    // writes one; after that the file is the operator's, and only they change
    // it. Its key is not printed here -- the log is read by more than the
    // file is.
    if (!config.fixedAdminDbKey.empty()) {
        adminDbKeyPath_.clear();
        std::printf("[admin] database editor key: %s (fixed)\n", config.fixedAdminDbKey.c_str());
    } else {
        adminDbKeyPath_ = admin_db::keyFileFor(config.databasePath);
        std::string key;
        std::string keyError;
        if (!admin_db::keyFileExists(adminDbKeyPath_)) {
            const std::string address = admin_db::privateAddress();
            if (admin_db::createKeyFile(adminDbKeyPath_,
                                        admin_db::deriveKey(database_.serverSecret(), address),
                                        keyError)) {
                std::printf("[admin] wrote a new database editor key to %s (from %s)\n",
                            adminDbKeyPath_.c_str(),
                            address.empty() ? "no network address" : address.c_str());
            } else {
                std::fprintf(stderr, "[admin] %s\n", keyError.c_str());
            }
        }
        if (admin_db::readKeyFile(adminDbKeyPath_, key, keyError)) {
            std::printf("[admin] database editor key: in %s\n", adminDbKeyPath_.c_str());
        } else {
            std::fprintf(stderr, "[admin] database editor locked: %s\n", keyError.c_str());
        }
    }

    rng_.reseed(config.worldSeed);
    // Derived from the same seed, so a world is still reproducible end to end,
    // but a stream of its own -- see botRng_.
    botRng_.reseed(config.worldSeed ^ 0x80757331B07B07ull);
    sacrificeRng_.reseed(config.worldSeed ^ 0x5AC21F1CEull);
    terrain_ = std::make_unique<Terrain>();
    // Every map the data directory stages, in manifest order: each one gets a
    // realm, a tile grid inside `terrain_` and an annotation layer inside
    // `worldMaps_`. A map that will not load IS fatal -- a teleporter aimed at
    // a missing map would drop players into a realm of solid wall -- while an
    // annotation layer that will not load is only reported.
    if (!worldMaps_.load(config.dataDir, terrain_.get(), errorOut)) return false;
    for (const std::string& warning : worldMaps_.warnings()) {
        contentWarning("[map] %s\n", warning.c_str());
    }
    initHostedArena();
    expireMarketListings();

    movement_ = std::make_unique<MovementSystem>();
    // The AI caches queries against one world and wanders from its own
    // stream, so it takes both at construction rather than per call.
    mobAi_ = std::make_unique<MobAiSystem>(world_, config.worldSeed ^ 0x9E3779B9ull);
    petals_ = std::make_unique<PetalSystem>();
    // The broadphases were built before the maps were: their layers are sized
    // to the default world until they are told what shape each realm really is.
    sizeBroadphases();
    combat_ = std::make_unique<CombatSystem>();
    spawning_ = std::make_unique<SpawnSystem>();
    spawning_->seedBossClocks(config.worldSeed ^ 0xB055C10C5ull);
    modes_ = std::make_unique<ModeSpawner>();
    dungeons_ = std::make_unique<DungeonSystem>();
    loot_ = std::make_unique<LootSystem>();
    if (!loot_->loadTables(content(), config.dataDir + "/mob_drops.json", errorOut)) return false;
    // The NPCs the maps ask for, resolved against the content once. A site
    // that names nothing placeable is reported rather than fatal: the map
    // still plays, it is only missing whoever was meant to stand there.
    npcs_ = std::make_unique<NpcSystem>();
    npcs_->seed(config.worldSeed ^ 0x0DAC1E5EEDull);
    {
        std::vector<std::string> npcWarnings;
        npcs_->loadSites(worldMaps_, content(), npcWarnings);
        for (const std::string& warning : npcWarnings) {
            contentWarning("[map] %s\n", warning.c_str());
        }
    }

    // Wire ids are unique across the whole server, so the id space belongs
    // here rather than to any one system. A system left unwired still
    // simulates -- its entities are simply not replicated, which is what a
    // headless test wants and what this must not be in production.
    petals_->allocateNetId = [this] { return netIds_.next(); };
    mobAi_->allocateNetId = [this] { return netIds_.next(); };
    spawning_->netIds = &netIds_;
    loot_->netIds = &netIds_;
    npcs_->netIds = &netIds_;
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
        // A dungeon copy's own pad leads back out beside the nest it was
        // entered through, wherever the pad's targetMap points: eight copies
        // of one map share one pad, and each belongs to a different nest.
        if (const Transform* at = world_.tryGet<Transform>(entity)) {
            const Body* body = world_.tryGet<Body>(entity);
            dungeons_->exitFor(at->realm, rng_, body != nullptr ? body->radius : 25.0, realm,
                               position);
        }
        moveEntityToRealm(entity, realm, position);
    };
    dungeons_->worldMaps = &worldMaps_;
    dungeons_->moveToRealm = [this](Entity entity, Realm realm, Vec2 position) {
        moveEntityToRealm(entity, realm, position);
    };
    dungeons_->admits = [this](Entity entity) { return botForEntity(entity) == nullptr; };
    // Bots exist to populate the OVERWORLD, and their controller is written
    // against it: its flow field, its ray casts and its broadphase queries
    // all read that one map. A bot carried through a pad would steer around
    // walls it is not standing among, so pads simply do not take bots.
    movement_->takesTeleporters = [this](Entity entity) { return botForEntity(entity) == nullptr; };
    loot_->terrain = terrain_.get();
    combat_->terrain = terrain_.get();

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
    // The maps' NPCs are part of the maps, so they stand from boot rather than
    // from whenever the first player happens to arrive.
    npcs_->placeMissing(world_, *terrain_, content(), clockMillis_);
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
    saveDatabase();
    return saved;
}

void GameServer::saveDatabase() {
    // Which bosses stand NOW, not as of the last population pass: the file is
    // what a restart -- a crash included -- comes back to, so a boss placed or
    // killed in the last half second has to be on the right side of it.
    if (bossClocksRestored_) {
        spawning_->noteStandingBosses(world_, commands_);
        persistBossClocks();
    }
    database_.save();
}

void GameServer::restoreBossClocks(double nowMillis) {
    bossClocksRestored_ = true;
    const Json& table = database_.storedTable("bossClocks");
    if (!table.isObject()) return;
    // Stored on the wall clock, which is the only one two runs share; this
    // run's clock is whatever tick() is handed. A ready time further out than
    // a whole cooldown can only be a wall clock that has since been set back,
    // and is pulled in to one cooldown rather than left to wait it out.
    const double offset = nowMillis - static_cast<double>(database_.nowMillis());
    for (const std::string& biome : table.keys()) {
        const Json& entry = table[biome];
        if (!entry["uniqueReadyAt"].isNumber() || !entry["apexReadyAt"].isNumber()) continue;
        const double unique = std::min(entry["uniqueReadyAt"].asDouble() + offset,
                                       nowMillis + kUniqueSpawnCooldownMillis);
        const double apex = std::min(entry["apexReadyAt"].asDouble() + offset,
                                     nowMillis + kApexSpawnCooldownMillis);
        spawning_->restoreBossClock(biome, unique, apex);
        savedBossClocks_.push_back(SavedBossClock{biome, unique, apex});
    }
}

void GameServer::persistBossClocks() {
    const double offset = static_cast<double>(database_.nowMillis()) - clockMillis_;
    for (const SpawnSystem::BiomeBossClock& clock : spawning_->bossClocks()) {
        if (!clock.scattered) continue;
        // A boss still standing is one a restart would take away unkilled, so
        // the cooldown it started is handed back: its clock is saved as of the
        // moment the boss spent it, which the next run reads as ready. Once it
        // dies the real ready time goes back in.
        const double unique = clock.uniqueStanding
                                  ? clock.uniqueReadyMillis - kUniqueSpawnCooldownMillis
                                  : clock.uniqueReadyMillis;
        const double apex = clock.apexStanding ? clock.apexReadyMillis - kApexSpawnCooldownMillis
                                               : clock.apexReadyMillis;
        SavedBossClock* saved = nullptr;
        for (SavedBossClock& candidate : savedBossClocks_) {
            if (candidate.biome == clock.biome) saved = &candidate;
        }
        if (saved != nullptr && saved->uniqueReadyMillis == unique &&
            saved->apexReadyMillis == apex) {
            continue;
        }
        if (saved == nullptr) {
            savedBossClocks_.push_back(SavedBossClock{clock.biome});
            saved = &savedBossClocks_.back();
        }
        saved->uniqueReadyMillis = unique;
        saved->apexReadyMillis = apex;
        Json entry = Json::object();
        entry["uniqueReadyAt"] = std::round(unique + offset);
        entry["apexReadyAt"] = std::round(apex + offset);
        database_.rawTable("bossClocks")[clock.biome] = std::move(entry);
        database_.markDirty();
    }
}

bool GameServer::step() {
    if (!running_.load()) return false;

    const double now = monotonicMillis();

    // Sleep in the network poll rather than in a bare sleep, so a packet
    // arriving mid-frame is picked up immediately instead of waiting out
    // the remainder of the tick.
    const int waitMillis = static_cast<int>(std::max(0.0, nextTickMillis_ - now));
    serviceNetwork(std::min(waitMillis, 5));
    // What the handlers just answered -- a Pong, an AuthResult, a CraftResult
    // -- leaves now, not at the next drain. Under Node that drain is the next
    // step, a whole 60 Hz timer away, or the end of a tick: on loopback it was
    // half of every round trip (median 21 ms without this flush, 10 with it).
    listener_.flush();

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
        foldTickPhases(tookMillis);
        if (tookMillis >= kSlowTickLogMillis && tookMillis > slowTickWorstMillis_) {
            slowTickWorstMillis_ = tookMillis;
            slowTickLine_ = describeTickPhases(tookMillis);
        }

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
            if (!slowTickLine_.empty()) {
                std::printf("%s\n", slowTickLine_.c_str());
                std::fflush(stdout);
                slowTickLine_.clear();
            }
            slowTickWorstMillis_ = 0;
        }
    }

    return running_.load();
}

void GameServer::serviceNetwork(int timeoutMillis) {
    listener_.poll(*this, timeoutMillis);
}

void GameServer::serviceArrivals() {
    if (!running_.load()) return;
    serviceNetwork(0);
    listener_.flush();
}

std::size_t GameServer::playerCount() const {
    std::size_t n = 0;
    for (const auto& entry : sessions_) {
        if (entry.second.playing()) ++n;
    }
    return n;
}

void GameServer::sizeBroadphases() {
    grid_.sizeToRealms(*terrain_);
    // Their own grids, not grid_'s: each is rebuilt at a different point in
    // the tick (see the systems). An unsized one is never WRONG -- a query
    // only gets a superset -- but a biome left one cell wide hands every
    // neighbour query the whole biome, which is what made separation and
    // petal attraction most of the tick under a bot crowd.
    if (movement_) movement_->sizeToRealms(*terrain_);
    if (petals_) petals_->sizeToRealms(*terrain_);
}

void GameServer::markTickPhase(const char* name) {
    if (tickPhaseCount_ < tickPhases_.size()) {
        tickPhases_[tickPhaseCount_++] = TickPhase{name, monotonicMillis()};
    }
}

std::string GameServer::describeTickPhases(double tookMillis) const {
    char buffer[64];
    std::snprintf(buffer, sizeof buffer, "[tick] slow tick %.1f ms:", tookMillis);
    std::string line = buffer;
    double from = tickStartedMillis_;
    bool any = false;
    for (std::size_t i = 0; i < tickPhaseCount_; ++i) {
        const double took = tickPhases_[i].endedMillis - from;
        from = tickPhases_[i].endedMillis;
        // The phases that cost nothing are most of them, and listing them
        // buries the one that did.
        if (took < 1.0) continue;
        std::snprintf(buffer, sizeof buffer, "%s %s %.1f", any ? "," : "", tickPhases_[i].name,
                      took);
        line += buffer;
        any = true;
    }
    if (!any) line += " no phase over 1 ms";
    return line;
}

void GameServer::foldTickPhases(double tookMillis) {
    const auto add = [](TickPhaseTotal& total, double took) {
        total.totalMillis += took;
        if (took > total.maxMillis) total.maxMillis = took;
        ++total.runs;
    };
    // Where the next phase not seen before goes: straight after the one this
    // tick ran before it.
    std::size_t insertAt = 0;
    double from = tickStartedMillis_;
    for (std::size_t i = 0; i < tickPhaseCount_; ++i) {
        const TickPhase& phase = tickPhases_[i];
        std::size_t at = 0;
        while (at < tickPhaseTotals_.size() && tickPhaseTotals_[at].name != phase.name &&
               std::strcmp(tickPhaseTotals_[at].name, phase.name) != 0) {
            ++at;
        }
        if (at == tickPhaseTotals_.size()) {
            at = insertAt;
            tickPhaseTotals_.insert(tickPhaseTotals_.begin() + static_cast<std::ptrdiff_t>(at),
                                    TickPhaseTotal{phase.name});
        }
        add(tickPhaseTotals_[at], phase.endedMillis - from);
        from = phase.endedMillis;
        insertAt = at + 1;
    }
    add(tickOtherTotal_, std::max(0.0, tookMillis - (from - tickStartedMillis_)));
}

void GameServer::tick(double nowMillis) {
    ++tick_;
    clockMillis_ = nowMillis;
    expirePoll();
    if(nowMillis>=nextMarketExpiryCheckMillis_){
        nextMarketExpiryCheckMillis_=nowMillis+1000;
        expireMarketListings();
    }
    tickPhaseCount_ = 0;
    if (!bossClocksRestored_) restoreBossClocks(nowMillis);
    tickStartedMillis_ = monotonicMillis();

    // First, so a session whose socket is gone is not counted as a player,
    // simulated or saved by anything below. Above the idle gate because such a
    // session is exactly what keeps a server from ever going idle.
    if (nowMillis >= nextSocketAuditMillis_) {
        nextSocketAuditMillis_ = nowMillis + 1000.0;
        reapSessionsWithoutSockets();
        reapUngreeted();
    }

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
    // Above the idle gate too: a member logging out of the title screen
    // changes every guildmate's roster whether or not anybody is playing.
    serviceGuildPresence(nowMillis);
    markTickPhase("sessions");

    // Housekeeping, ABOVE the idle gate: an account registered by somebody
    // sitting on the title screen is dirty in memory and would otherwise wait
    // for the next player to actually join before it reached the disk.
    if (nowMillis >= nextPersistMillis_) {
        nextPersistMillis_ = nowMillis + kPersistIntervalMillis;
        database_.pruneExpiredSessions();
        persistAll();
    }
    markTickPhase("persist");

    // Bot population is maintained on every tick, INCLUDING the idle ones the
    // gate below returns out of -- that is where the reference calls it, and
    // it is what lets an empty server retire its bots after the grace period
    // rather than leaving them simulating for nobody.
    maintainBots(nowMillis);
    markTickPhase("bot population");

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

    runSystems(nowMillis, smoothedDeltaSeconds_);
    persistBossClocks();
    serviceSacrificeSpawn(nowMillis);
    serviceSacrificeRituals(nowMillis);

    // BEFORE the reaper. A splitter gives one connection two bodies, and a
    // half that died this tick has to stop being part of the session before
    // the reaper meets it -- otherwise its owner is shown a death card for a
    // flower they are no longer steering. It is also where the split follows
    // the loadout: equipping the petal splits, taking it off merges.
    serviceSplitters(nowMillis);
    markTickPhase("splitters");

    // After the splitters, which may have moved a controlled flower onto its
    // other half, and before the reaper for the splitters' own reason: a death
    // this tick ends the control first, so the admin's view is back on their
    // own flower before either corpse is announced.
    serviceControl();
    markTickPhase("control");

    reapDead();
    commands_.flush();
    markTickPhase("reap");

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
        sendDueProfiles();
        markTickPhase("profiles");
        replicate(nowMillis);
        markTickPhase("replicate");
        // One-shot events ride inside the snapshot here, where the reference
        // has its own per-tick outbox, so they are BANKED across the ticks that
        // send nothing rather than dropped: a hit that landed on a simulation
        // tick with no snapshot must still produce its number.
        events_.clear();
    }
    listener_.flush();
    markTickPhase("send");
}

void GameServer::runSystems(double nowMillis, double dt) {
    // Order matters and is the tick's whole contract:
    //   bot intent -> players -> petals -> mob intent/movement -> projectiles
    //   -> combat -> spawning -> loot.
    // The TypeScript server closed the player movement window and ran the
    // player's petal pipeline before moveEnemies(), then advanced projectiles
    // after the mobs, and this keeps that order.
    //
    // `dt` is the smoothed real step and drives the dt-SCALED half: flowers,
    // petals, combat's timed effects (afflictions, ground fields) and the
    // drops' lifetimes. The mob half is a FIXED per-call step, as it was in
    // the TypeScript server (src/server.ts:1321 handed moveEnemies a hard
    // 1/30), and projectile FLIGHT moves with it -- MovementSystem's world
    // phase steps the mobs and then the shots. So the mob AI, that phase and
    // the spawner are given net::kTickSeconds explicitly below rather than the
    // tick's delta.

    // Bots decide before anything moves, which is where the reference samples
    // input: their decisions are made against the world as this tick found it
    // and are consumed by the very next stage, not one tick later.
    stepBots(nowMillis);
    markTickPhase("bot ai");

    // Modifiers before movement, as the reference schedules them (its
    // playerModifiers system sits in Phase.Input, ahead of playerMovement).
    // Folded only inside the petal phase below, a speed or size petal would not
    // reach movement until the tick after it was equipped.
    petals_->foldModifiers(world_, content());

    serviceAdminPhase();
    movement_->runPlayerPhase(world_, *terrain_, nowMillis, dt);
    markTickPhase("players");
    petals_->run(world_, content(), nowMillis, dt, commands_, terrain_.get(), &events_);
    markTickPhase("petals");

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
    humanLaps_.clear();
    for (const auto& entry : sessions_) {
        if (!entry.second.playing()) continue;
        if (const Transform* transform = world_.tryGet<Transform>(entry.second.entity)) {
            humanPlayers_.push_back({transform->position, transform->realm});
            const PlayerInput* input = world_.tryGet<PlayerInput>(entry.second.entity);
            if (input == nullptr || !afkForSpawns(*input)) {
                humanLaps_.push_back({transform->position, transform->realm});
            }
        }
    }
    fileBodies(world_, grid_);
    markTickPhase("broadphase");

    // The reference server resolves flower bodies and the petal ring inside
    // the player pipeline, before moveEnemies(). Keep that temporal boundary:
    // a mob cannot escape a petal it was already touching by moving first.
    combat_->beginTick(world_, nowMillis, dt, events_);
    combat_->runContactPhase(world_, grid_, content(), nowMillis);
    markTickPhase("contact");

    mobAi_->run(world_, *terrain_, grid_, activePlayers_, nowMillis, net::kTickSeconds, commands_);
    markTickPhase("mob ai");
    movement_->runWorldPhase(world_, *terrain_, nowMillis, net::kTickSeconds);
    markTickPhase("mob movement");
    serviceAdminCursorActions();
    serviceAdminCursor();
    // After the bodies have moved, as gardn places its segments: whatever
    // pushed a bead this tick swings the chain rather than being undone.
    mobAi_->placeChains(world_, *terrain_, activePlayers_);
    // AFTER the mobs have moved, for the reason a flower's ring is placed
    // after its own movement: a seat is a rigid offset from the body, and a
    // ring carried before the body moves trails it by a tick.
    mobAi_->tickPetalRings(world_, commands_);

    // Combat exact-tests current transforms, but its candidate set comes from
    // this grid. Rebuild after mob/projectile flight so a cell crossing cannot
    // make a real overlap invisible for one tick.
    fileBodies(world_, grid_);
    markTickPhase("regrid");
    combat_->runWorldPhase(world_, grid_, content(), nowMillis, dt);
    // A summoning shot -- the spaceship's -- is only SEEN landing by combat;
    // the summon is the ring's, made once combat has stopped walking the world.
    petals_->landShots(world_, content(), combat_->shotLandings(), terrain_.get());
    // So is a C++ a yin yang landed on; the C-- it becomes is the spawner's.
    for (const MobConversion& conversion : combat_->conversions()) {
        spawning_->convertMob(world_, *terrain_, content(), conversion.mob, conversion.into,
                              nowMillis, rng_);
    }
    // And a mob a divider landed on. The petal breaks only if the mob came
    // apart, and then whatever else it touched this tick stays whole.
    for (const MobDivision& division : combat_->divisions()) {
        if (!world_.isAlive(division.petal)) continue;
        if (spawning_->divideMob(world_, *terrain_, content(), division.mob, division.pieces,
                                 nowMillis, rng_)) {
            petals_->breakSlot(world_, content(), division.owner, division.slot, nowMillis,
                               events_);
        }
    }
    markTickPhase("combat");
    spawning_->run(world_, *terrain_, content(), activePlayers_, rng_, nowMillis,
                   net::kTickSeconds, commands_);
    // What this tick's dead leave behind -- a tomb's mummy, its opened shell
    // -- read while combat's corpses are still in the world.
    {
        std::vector<Entity> deadMobs;
        for (const CombatSystem::DeathRecord& death : combat_->deaths()) {
            if (!death.wasPlayer) deadMobs.push_back(death.entity);
        }
        spawning_->answerDeaths(world_, *terrain_, content(), deadMobs, rng_, nowMillis,
                                net::kTickSeconds, commands_);
    }
    markTickPhase("spawning");
    // After combat, so a dungeon cleared this tick drops its nest this tick,
    // and before loot, so the nest's drops are rolled in the same pass.
    dungeons_->run(world_, *terrain_, content(), *spawning_, *combat_, rng_, nowMillis,
                   commands_);
    // The arena and the maze are filled whole rather than by viewport, and only
    // while someone is in them.
    modes_->run(world_, *terrain_, content(), *spawning_, grid_, humanPlayers_, humanLaps_, rng_,
                nowMillis);
    // Every flower, bots included, is somebody an NPC can turn to look at.
    npcs_->run(world_, *terrain_, content(), activePlayers_, nowMillis);
    if(nowMillis>=nextMarketGiftCheckMillis_){
        nextMarketGiftCheckMillis_=nowMillis+1000;
        for(const auto& site:npcs_->marketGiftSites(world_,nowMillis))
            loot_->spawnPublicMobLoot(world_,content(),rng_,content().mobIndex("bee"),Rarity::Ultra,site.position,site.realm);
    }
    markTickPhase("modes+npcs");
    loot_->run(world_, grid_, content(), rng_, nowMillis, dt, commands_, events_);
    markTickPhase("loot");

    // A pickup is a world event; owning it is an account fact. The loot system
    // deliberately knows nothing about the database, so the hand-off is here.
    bankPickups();
    // Same reasoning for kills: combat marks the corpse, the account keeps the
    // tally. Runs before the reaper, while MobType is still readable.
    bankKills();
    // After every death of the tick is in, the dungeons' and the Undead's
    // included: each mob a flower or its pet killed is a totem stack.
    petals_->creditKills(world_, *combat_, nowMillis);

    // The spawner has no view of the socket list, so it queues the bosses it
    // admitted rather than announcing them.
    announceBossSpawns();
    markTickPhase("banking");
    stepWaves(nowMillis);
    markTickPhase("waves");
}

void GameServer::reapDead() {
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
                offerSacrifice(*session, e);
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

        // Revalidate even when a modified client stops reporting its window.
        // Removing camera equipment must revoke the previously granted view.
        if (PlayerLocation* own = world_.tryGet<PlayerLocation>(session.entity)) {
            own->viewport = claimableViewport(world_, session.entity, content(),
                                             own->viewport.x, own->viewport.y);
        }

        collectSquadBodies(session, squadBodies);
        frame.alwaysVisible = squadBodies.empty() ? nullptr : &squadBodies;

        // Built around the flower this client is WATCHING, which is another
        // player's while an admin steers it -- and culled to the window this
        // client reported, which is its own body's claim, not that flower's:
        // the steered player's own stream keeps the box their screen asked
        // for. Nothing here decides whether the control still holds;
        // serviceControl did, this tick, and every way out of it since has
        // ended it on the spot.
        const Entity viewpoint = viewpointOf(session);
        frame.viewport.reset();
        if (viewpoint != session.entity) {
            if (const PlayerLocation* own = world_.tryGet<PlayerLocation>(session.entity)) {
                frame.viewport = own->viewport;
            }
        }

        scratch_.clear();
        replicator_.build(world_, viewpoint, views_[session.connection], frame, scratch_);
        if (!scratch_.empty()) connection->send(scratch_);
    }
}

void GameServer::broadcastDebugStats() {
    // Drained whether or not anyone is listening, so a window that spanned an
    // empty server does not pour its samples into the first client to join.
    const double avgMillis =
        debugTickSamples_ > 0 ? debugTickAccumMillis_ / debugTickSamples_ : 0.0;
    const double maxMillis = debugTickMaxMillis_;
    const int ticks = debugTickSamples_;
    debugTickAccumMillis_ = 0;
    debugTickMaxMillis_ = 0;
    debugTickSamples_ = 0;

    bool anyone = false;
    for (const auto& entry : sessions_) {
        if (entry.second.authenticated()) { anyone = true; break; }
    }

    ByteWriter w;
    if (anyone) {
        w.u8(static_cast<std::uint8_t>(net::ServerMessage::DebugStats));
        w.f64(static_cast<double>(residentBytes()));
        w.f64(static_cast<double>(heapBytes()));
        w.f32(static_cast<float>(avgMillis));
        w.f32(static_cast<float>(maxMillis));
        w.u16(static_cast<std::uint16_t>(std::min(ticks, 0xFFFF)));
        // Only the phases that ran this window: an idle server stops at the
        // idle gate, and rows of zeroes would say the work was free rather
        // than that it never happened.
        std::uint8_t ran = 0;
        for (const TickPhaseTotal& phase : tickPhaseTotals_) ran += phase.runs > 0 ? 1 : 0;
        if (tickOtherTotal_.runs > 0) ++ran;
        w.u8(ran);
        const auto put = [&w](const TickPhaseTotal& phase) {
            if (phase.runs <= 0) return;
            w.str(phase.name);
            w.f32(static_cast<float>(phase.totalMillis));
            w.f32(static_cast<float>(phase.maxMillis));
            w.u16(static_cast<std::uint16_t>(std::min(phase.runs, 0xFFFF)));
        };
        for (const TickPhaseTotal& phase : tickPhaseTotals_) put(phase);
        put(tickOtherTotal_);
    }
    for (TickPhaseTotal& phase : tickPhaseTotals_) phase = TickPhaseTotal{phase.name};
    tickOtherTotal_ = TickPhaseTotal{tickOtherTotal_.name};
    if (anyone) broadcastToAuthenticated(w);
}

} // namespace flix
