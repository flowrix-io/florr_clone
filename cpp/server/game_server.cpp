#include "server/game_server.h"

#include <algorithm>
#include <cctype>
#include <chrono>
#include <cstdio>
#include <optional>
#include <thread>

#include "server/systems/combat.h"
#include "server/systems/loot.h"
#include "server/systems/mob_ai.h"
#include "server/systems/movement.h"
#include "server/systems/petals.h"
#include "server/systems/spawning.h"
#include "shared/game/config.h"
#include "shared/game/shop.h"
#include "shared/game/skin_format.h"
#include "shared/game/skills.h"

namespace flr {

namespace {

double monotonicMillis() {
    using clock = std::chrono::steady_clock;
    static const clock::time_point start = clock::now();
    return std::chrono::duration<double, std::milli>(clock::now() - start).count();
}

/// Clamp on the viewport a client may claim. A client asking to see the whole
/// map is asking for an advantage, and for the server to build it a snapshot
/// of the entire world.
constexpr double kMaxViewportAxis = 2600.0;

/// How often account progress is written back from the live entity.
constexpr double kPersistIntervalMillis = 30000.0;

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
/// it. Five Basic petals is the smallest kit that is actually playable, plus a
/// couple of spares so the first break is not also the end of the run.
void grantStarterKit(PlayerRecord& record) {
    const std::uint16_t basic = content().petalIndex("basic");
    if (basic == kInvalidIndex) return;

    constexpr int kStartingEquipped = 5;
    constexpr int kStartingSpares = 3;

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

/// Case folding for every name comparison in the guild code. Guild membership
/// is case-insensitive in the reference -- a player invited as "Bob" answers as
/// "bob" -- so nothing here may compare raw bytes.
std::string lowerCase(std::string s) {
    for (char& c : s) c = static_cast<char>(std::tolower(static_cast<unsigned char>(c)));
    return s;
}

std::string trimmed(const std::string& s) {
    const std::size_t first = s.find_first_not_of(" \t\r\n");
    if (first == std::string::npos) return {};
    const std::size_t last = s.find_last_not_of(" \t\r\n");
    return s.substr(first, last - first + 1);
}

/// A guild's name IS its key: trimmed and upper-cased, so "alpha" and " Alpha "
/// are the same guild and cannot both be created.
std::string normalizeGuildName(const std::string& raw) {
    std::string name = trimmed(raw);
    for (char& c : name) c = static_cast<char>(std::toupper(static_cast<unsigned char>(c)));
    return name;
}

/// Exactly five A-Z or 0-9, which is what makes the name short enough to hang
/// under a nameplate as a tag.
bool validGuildName(const std::string& name) {
    if (name.size() != 5) return false;
    for (const char c : name) {
        const auto byte = static_cast<unsigned char>(c);
        if (!std::isupper(byte) && !std::isdigit(byte)) return false;
    }
    return true;
}

constexpr std::size_t kMaxGuildSize = 200;
/// A guild invitation lapses after a minute, as the reference's does.
constexpr std::int64_t kGuildInviteMillis = 60000;

/// Position of `username` in a guild's member array, or -1.
int guildMemberIndex(const Json& guild, const std::string& username) {
    const Json& members = guild["memberUsernames"];
    const std::string key = lowerCase(username);
    for (std::size_t i = 0; i < members.size(); ++i) {
        if (lowerCase(members[i].asString()) == key) return static_cast<int>(i);
    }
    return -1;
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

    if (!loadContent(config.dataDir, errorOut)) return false;
    for (const std::string& warning : content().warnings()) {
        std::fprintf(stderr, "[content] %s\n", warning.c_str());
    }

    // A database that exists but will not parse is fatal at startup. Coming up
    // with an empty one would serve every returning player a blank account and,
    // worse, save that over the file they still had.
    if (!database_.load(config.databasePath, errorOut)) return false;

    rng_.reseed(config.worldSeed);
    terrain_ = std::make_unique<Terrain>();
    if (!terrain_->loadMapBundle(config.dataDir + "/map_bundle.ts", errorOut)) return false;
    // The annotation layer is optional: without it every spawn falls back to
    // the middle of the map, which is survivable for a server operator to see
    // in a warning but not worth refusing to start over.
    std::string mapWarning;
    if (!mapData_.load(config.dataDir + "/map_bundle.ts", mapWarning)) {
        std::fprintf(stderr, "[map] %s; spawns will fall back to the map centre\n",
                     mapWarning.c_str());
    }

    movement_ = std::make_unique<MovementSystem>();
    // The AI caches queries against one world and wanders from its own
    // stream, so it takes both at construction rather than per call.
    mobAi_ = std::make_unique<MobAiSystem>(world_, config.worldSeed ^ 0x9E3779B9ull);
    petals_ = std::make_unique<PetalSystem>();
    combat_ = std::make_unique<CombatSystem>();
    spawning_ = std::make_unique<SpawnSystem>();
    loot_ = std::make_unique<LootSystem>();
    if (!loot_->loadTables(content(), config.dataDir + "/mob_drops.json", errorOut)) return false;

    // Wire ids are unique across the whole server, so the id space belongs
    // here rather than to any one system. A system left unwired still
    // simulates -- its entities are simply not replicated, which is what a
    // headless test wants and what this must not be in production.
    petals_->allocateNetId = [this] { return netIds_.next(); };
    spawning_->netIds = &netIds_;
    loot_->netIds = &netIds_;

    if (!listener_.start(config.port, errorOut)) return false;

    running_ = true;
    return true;
}

void GameServer::run() {
    double nextTickMillis = monotonicMillis();

    while (running_.load()) {
        const double now = monotonicMillis();

        // Sleep in the network poll rather than in a bare sleep, so a packet
        // arriving mid-frame is picked up immediately instead of waiting out
        // the remainder of the tick.
        const int waitMillis = static_cast<int>(std::max(0.0, nextTickMillis - now));
        serviceNetwork(std::min(waitMillis, 5));

        if (monotonicMillis() >= nextTickMillis) {
            tick(nextTickMillis);
            nextTickMillis += net::kTickMillis;

            // If the server fell far behind (a long stall, a suspended laptop),
            // give up on catching the missed ticks: replaying them in a burst
            // would teleport every entity. Resync to now instead.
            const double drift = monotonicMillis() - nextTickMillis;
            if (drift > net::kTickMillis * 5) nextTickMillis = monotonicMillis();
        }
    }

    // Flush account progress before exiting; an orderly shutdown must not cost
    // anyone their session.
    for (const auto& entry : sessions_) {
        if (entry.second.playing()) persistPlayer(entry.second);
    }
    database_.save();
    listener_.stop();
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
    events_.clear();

    for (auto& entry : sessions_) refillAllowances(entry.second, nowMillis);

    // The active-player list is rebuilt once and shared: spawning and the mob
    // LOD both need it, and walking the player query per system would cost the
    // same work several times over.
    activePlayers_.clear();
    Query<PlayerTag, Transform> players{world_};
    players.each([&](Entity, PlayerTag&, Transform& transform) {
        activePlayers_.push_back(transform.position);
    });

    // The broadphase is rebuilt from scratch each tick. Incremental updates
    // sound cheaper but need every mover to report its old cell, and one missed
    // report leaves a stale entry that reads as a phantom collision.
    grid_.clear();
    Query<Transform, Body> collidable{world_};
    collidable.each([&](Entity e, Transform& transform, Body& body) {
        grid_.insert(e, transform.position, body.radius);
    });

    // Record which input each player's movement is about to consume. The
    // snapshot reports this back, and it is the whole basis of reconciliation:
    // the client discards the predicted inputs at or below it and replays only
    // what is still outstanding. Left at zero, every client replays its entire
    // queue on top of an already-current position and drifts further each tick.
    Query<PlayerTag, PlayerInput> inputs{world_};
    inputs.each([](Entity, PlayerTag&, PlayerInput& input) {
        input.lastAppliedSequence = input.current.sequence;
    });

    runSystems(nowMillis, net::kTickSeconds);

    reapDead(nowMillis);
    commands_.flush();

    replicate(nowMillis);
    listener_.flush();

    if (nowMillis >= nextPersistMillis_) {
        nextPersistMillis_ = nowMillis + kPersistIntervalMillis;
        for (const auto& entry : sessions_) {
            if (entry.second.playing()) persistPlayer(entry.second);
        }
        database_.pruneExpiredSessions();
        database_.save();
    }
}

void GameServer::runSystems(double nowMillis, double dt) {
    // Order matters and is the tick's whole contract:
    //   intent -> movement -> ring placement -> damage -> lifecycle.
    // Petals are placed AFTER movement so they orbit where the player ended up
    // this tick, not where it started; combat runs after both so a petal hits
    // from its final position.
    mobAi_->run(world_, *terrain_, grid_, activePlayers_, nowMillis, dt, commands_);
    movement_->run(world_, *terrain_, nowMillis, dt);
    petals_->run(world_, content(), nowMillis, dt, commands_);
    combat_->run(world_, grid_, content(), nowMillis, dt, commands_, events_);
    spawning_->run(world_, *terrain_, content(), activePlayers_, rng_, nowMillis, dt, commands_);
    loot_->run(world_, grid_, content(), rng_, nowMillis, dt, commands_, events_);

    // A pickup is a world event; owning it is an account fact. The loot system
    // deliberately knows nothing about the database, so the hand-off is here.
    bankPickups();
    // Same reasoning for kills: combat marks the corpse, the account keeps the
    // tally. Runs before the reaper, while MobType is still readable.
    bankKills();
}

void GameServer::bankPickups() {
    for (const LootSystem::Pickup& pickup : loot_->pickups()) {
        Session* session = sessionForEntity(pickup.player);
        if (!session || session->userId.empty()) continue;
        if (pickup.petalIndex >= content().petalCount()) continue;

        giveToInventory(database_.progress(session->userId), pickup.petalIndex, pickup.rarity, 1);
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

        // A player's corpse KEEPS its Dead tag, which is what puts the dead
        // face and the dead state on the wire and what makes every system step
        // over the body. That means this loop meets the same corpse on every
        // later tick, so everything below has to happen exactly once.
        if (isPlayer) {
            if (session == nullptr) {
                // A body whose session has gone has nobody watching through it.
                commands_.destroy(e);
                continue;
            }
            if (session->deathReported) continue;
        }

        if (world_.has<NetId>(e)) {
            const Transform* transform = world_.tryGet<Transform>(e);
            events_.killed(world_.get<NetId>(e).value, transform ? transform->position : Vec2{});
        }

        if (isPlayer) {
            session->deathReported = true;
            persistPlayer(*session);
            if (net::Connection* connection = listener_.find(session->connection)) {
                ByteWriter w;
                w.u8(static_cast<std::uint8_t>(net::ServerMessage::Died));
                w.str(killerLabel(world_, world_.get<Dead>(e).killer));
                w.u32(0);
                w.u32(tick_);
                connection->send(w);
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
    frame.nowMillis = nowMillis;
    frame.events = &events_;

    for (auto& entry : sessions_) {
        Session& session = entry.second;
        if (!session.playing()) continue;
        net::Connection* connection = listener_.find(session.connection);
        if (!connection) continue;

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
        if (entry.second.entity == e) return &entry.second;
    }
    return nullptr;
}

void GameServer::onConnect(net::Connection& connection) {
    Session session;
    session.connection = connection.id();
    session.connectedAtMillis = monotonicMillis();
    session.lastHeardMillis = session.connectedAtMillis;
    sessions_[connection.id()] = session;
    views_[connection.id()] = ClientView{};
}

void GameServer::onDisconnect(net::Connection& connection, const std::string&) {
    if (Session* session = sessionFor(connection.id())) {
        if (session->playing()) {
            persistPlayer(*session);
            despawnPlayer(*session, false);
        }
    }
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
        case net::ClientMessage::JoinGame:      handleJoin(*session, connection, reader); break;
        case net::ClientMessage::LeaveGame:     handleLeave(*session, connection); break;
        case net::ClientMessage::Input:         handleInput(*session, reader); break;
        case net::ClientMessage::Chat:          handleChat(*session, connection, reader); break;
        case net::ClientMessage::SetLoadout:    handleSetLoadout(*session, reader); break;
        case net::ClientMessage::SwapLoadout:   handleSwapLoadout(*session, reader); break;
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
        case net::ClientMessage::Logout:
            session->stage = SessionStage::Anonymous;
            if (!session->token.empty()) database_.revokeSession(session->token);
            session->token.clear();
            session->userId.clear();
            break;
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

    const CreateResult result = database_.createUser(username, password);
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

void GameServer::sendProfile(Session& session, net::Connection& connection) {
    const PlayerRecord& record = database_.progress(session.userId);

    ByteWriter w;
    w.u8(static_cast<std::uint8_t>(net::ServerMessage::Profile));
    w.str(session.username);
    w.f64(record.totalXp);
    w.u16(static_cast<std::uint16_t>(levelFromTotalXp(record.totalXp).level));
    w.u32(static_cast<std::uint32_t>(std::max(0, record.stars)));

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

    w.u8(static_cast<std::uint8_t>(kLoadoutSlots));
    for (std::size_t i = 0; i < kLoadoutSlots; ++i) {
        std::uint16_t index = kNoPetal;
        Rarity rarity = Rarity::Common;
        if (i < record.loadout.size() && record.loadout[i].has_value()) {
            const StoredItem& item = *record.loadout[i];
            index = content().petalIndex(item.petalType);
            if (index == kInvalidIndex) index = kNoPetal;
            rarity = item.rarity;
        }
        w.u16(index);
        w.u8(static_cast<std::uint8_t>(rarity));
    }

    w.u32(record.renderFlags);

    // The talent tree. Only branches that have been bought are sent; the
    // balance is derived on both sides from the level, so it is not on the
    // wire at all and cannot arrive disagreeing with the tiers beside it.
    const std::size_t skillCountAt = w.reserveU16();
    std::uint16_t skillCount = 0;
    for (int i = 0; i < kSkillCount; ++i) {
        const int tier = record.skills.tier[static_cast<std::size_t>(i)];
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
                                int stars, const std::string& message) {
    ByteWriter w;
    w.u8(static_cast<std::uint8_t>(net::ServerMessage::ShopResult));
    w.u8(static_cast<std::uint8_t>(kind));
    w.boolean(ok);
    w.u32(static_cast<std::uint32_t>(std::max(0, stars)));
    w.str(message);
    connection.send(w);
}

void GameServer::broadcastChat(net::ChatChannel channel, const std::string& author,
                               const std::string& text) {
    ByteWriter w;
    w.u8(static_cast<std::uint8_t>(net::ServerMessage::Chat));
    w.u8(static_cast<std::uint8_t>(channel));
    w.str(author);
    w.str(text);
    listener_.each([&](net::Connection& connection) {
        const Session* session = sessionFor(connection.id());
        if (session && session->authenticated()) connection.send(w);
    });
}

void GameServer::handleJoin(Session& session, net::Connection& connection, ByteReader& reader) {
    const double width = reader.u16();
    const double height = reader.u16();
    const std::string biome = reader.str();
    const std::string name = reader.str();
    if (!reader.ok()) return;
    if (!session.authenticated()) return;
    if (session.playing()) return;

    // The nameplate, not the account. Kept on the session so a respawn keeps
    // the name the player typed rather than reverting to their login.
    session.displayName = sanitizePlayerName(name);

    // Remembered on the session so a respawn returns to the biome the player
    // chose, rather than quietly sending them back to the beginner ground.
    // A biome the map has no safe area for is dropped here, once, with a
    // notice -- rather than silently every time they die.
    session.spawnBiome.clear();
    if (!biome.empty() && biome != "default") {
        Vec2 probe;
        if (mapData_.spawnInBiome(biome, rng_, *terrain_, probe)) {
            session.spawnBiome = biome;
        } else {
            sendNotice(connection, net::NoticeSeverity::Warning,
                       "No safe ground in that biome; starting in the garden.");
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
    // This is the exact decoded TypeScript wall grid. Forty kilobytes once per
    // join is comfortably below the frame cap and cannot drift from collision.
    w.u16(static_cast<std::uint16_t>(terrain_->tileCount()));
    w.raw(terrain_->tiles(), terrain_->tileCount());
    connection.send(w);

    broadcastChat(net::ChatChannel::System, "", session.username + " joined");
}

void GameServer::handleLeave(Session& session, net::Connection& connection) {
    if (!session.playing()) return;
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
}

void GameServer::handleChat(Session& session, net::Connection& connection, ByteReader& reader) {
    const std::string raw = reader.str();
    if (!reader.ok() || !session.authenticated()) return;
    if (!spend(session.chatAllowance)) {
        sendNotice(connection, net::NoticeSeverity::Warning, "You are sending messages too quickly.");
        return;
    }
    const std::string text = sanitizeChat(raw);
    if (text.empty()) return;
    broadcastChat(net::ChatChannel::Global, session.username, text);
}

void GameServer::handleSetLoadout(Session& session, ByteReader& reader) {
    const std::uint8_t slot = reader.u8();
    const std::uint16_t petalIndex = reader.u16();
    const Rarity rarity = clampRarity(reader.u8());
    if (!reader.ok() || !session.authenticated()) return;
    if (slot >= kLoadoutSlots) return;
    if (petalIndex != kNoPetal && petalIndex >= content().petalCount()) return;

    PlayerRecord& record = database_.progress(session.userId);
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

    if (session.playing()) applyAccountToEntity(record, session.entity);
    if (net::Connection* connection = listener_.find(session.connection)) {
        sendProfile(session, *connection);
    }
}

void GameServer::handleSwapLoadout(Session& session, ByteReader& reader) {
    const std::uint8_t a = reader.u8();
    const std::uint8_t b = reader.u8();
    if (!reader.ok() || !session.authenticated()) return;
    if (a >= kLoadoutSlots || b >= kLoadoutSlots || a == b) return;

    PlayerRecord& record = database_.progress(session.userId);
    if (record.loadout.size() < kLoadoutSlots) record.loadout.resize(kLoadoutSlots);
    std::swap(record.loadout[a], record.loadout[b]);
    database_.markDirty();

    if (session.playing()) applyAccountToEntity(record, session.entity);
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

    PlayerRecord& record = database_.progress(session.userId);
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
    const double chance = craftSuccessChance(rarity);
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

    w.boolean(crafted > 0);
    w.u16(petalIndex);
    w.u8(static_cast<std::uint8_t>(crafted > 0 ? upgradeRarity(rarity) : rarity));
    w.u16(static_cast<std::uint16_t>(crafted));
    w.u8(static_cast<std::uint8_t>(petalsReturned));
    w.str(crafted > 0 ? "" : "The craft failed.");
    connection.send(w);
    sendProfile(session, connection);
}

void GameServer::bankKills() {
    for (const CombatSystem::DeathRecord& death : combat_->deaths()) {
        if (death.wasPlayer) continue;
        const MobType* type = world_.tryGet<MobType>(death.entity);
        if (type == nullptr) continue;
        // A pet's kill belongs to the player who summoned it, and the loot
        // system has already resolved that attribution onto Dead::killer.
        Session* session = sessionForEntity(death.killer);
        if (session == nullptr || session->userId.empty()) continue;

        PlayerRecord& record = database_.progress(session->userId);
        record.recordKill(content().mob(type->configIndex).id, type->rarity);

        // Stars are the mythic-and-above bounty. Awarded on the live entity
        // rather than the record so the HUD sees them this tick; persistPlayer
        // copies them back the same way it does XP.
        const int stars = starsForKill(type->rarity);
        if (stars > 0) {
            if (PlayerProgress* live = world_.tryGet<PlayerProgress>(death.killer)) {
                live->stars += stars;
                record.stars = live->stars;
            } else {
                record.stars += stars;
            }
            if (net::Connection* connection = listener_.find(session->connection)) {
                sendNotice(*connection, net::NoticeSeverity::Good,
                           "+" + std::to_string(stars) + " star" + (stars == 1 ? "" : "s") +
                               " for a " + rarityLabel(type->rarity) + " kill");
            }
        }
        database_.markDirty();

        if (net::Connection* connection = listener_.find(session->connection)) {
            sendProfile(*session, *connection);
        }
    }
}

void GameServer::handleUpgradeSkill(Session& session, net::Connection& connection,
                                    ByteReader& reader) {
    const std::uint8_t rawSkill = reader.u8();
    const int tier = reader.u8();
    if (!reader.ok() || !session.authenticated()) return;
    if (rawSkill >= kSkillCount) return;

    const SkillId id = static_cast<SkillId>(rawSkill);
    PlayerRecord& record = database_.progress(session.userId);

    // Tiers are bought one at a time, in order. Accepting an arbitrary target
    // would let a client skip the tiers below it and pay for one of them.
    if (tier < 0 || tier >= skillTierCount(id) || tier != record.skills.level(id) + 1) {
        sendNotice(connection, net::NoticeSeverity::Warning, "Talents are bought in order.");
        return;
    }
    if (id == SkillId::SecondChance && !record.skills.secondChanceUnlocked()) {
        sendNotice(connection, net::NoticeSeverity::Warning,
                   std::string("Second Chance needs ") + rarityLabel(kSecondChanceRequirement) +
                       " " + kSkillLabels[static_cast<std::size_t>(kSecondChanceParent)] + ".");
        return;
    }

    const int cost = kTierCost[static_cast<std::size_t>(tier)];
    if (record.talentPoints() < cost) {
        sendNotice(connection, net::NoticeSeverity::Warning,
                   "Not enough talent points (need " + std::to_string(cost) + ").");
        return;
    }

    record.skills.set(id, tier);
    database_.markDirty();
    if (session.playing() && world_.isAlive(session.entity)) {
        applyAccountToEntity(record, session.entity);
    }
    sendProfile(session, connection);
}

void GameServer::handleResetSkills(Session& session, net::Connection& connection) {
    if (!session.authenticated()) return;
    PlayerRecord& record = database_.progress(session.userId);
    record.skills.clear();
    database_.markDirty();
    if (session.playing() && world_.isAlive(session.entity)) {
        applyAccountToEntity(record, session.entity);
    }
    sendProfile(session, connection);
    sendNotice(connection, net::NoticeSeverity::Info, "Talents reset; every point refunded.");
}

void GameServer::handleBuyPetal(Session& session, net::Connection& connection, ByteReader& reader) {
    const std::uint16_t petalIndex = reader.u16();
    const Rarity rarity = clampRarity(reader.u8());
    if (!reader.ok() || !session.authenticated()) return;

    // The client sends what it wants, never what it costs. A price that came
    // off the wire is a price the client chose.
    if (!shopSellsPetal(petalIndex) || !shopSellsRarity(rarity)) {
        sendShopResult(connection, net::ShopResultKind::Purchase, false, 0, "That is not for sale.");
        return;
    }

    PlayerRecord& record = database_.progress(session.userId);
    const double price = shopPrice(petalIndex, rarity);
    PlayerProgress* live = session.playing() && world_.isAlive(session.entity)
                               ? world_.tryGet<PlayerProgress>(session.entity)
                               : nullptr;
    const int stars = live ? live->stars : record.stars;
    if (static_cast<double>(stars) < price) {
        sendShopResult(connection, net::ShopResultKind::Purchase, false, 0, "Not enough stars.");
        return;
    }

    const int spent = static_cast<int>(price);
    record.stars = stars - spent;
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

    const int stars = stored["stars"].asInt(0);
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
    database_.markDirty();
    if (session.playing() && world_.isAlive(session.entity)) {
        world_.ensure<PlayerVisuals>(session.entity).renderFlags = flags;
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
    connection.send(w);
}

/// A guest account, which may play but may not add to the shared catalog.
///
/// The reference tests `/^User\d{8}$/`; this build's guest minting does not
/// zero-pad (client/app.cpp), so the digit run is matched at any length rather
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

void GameServer::sendSkinCatalog(Session& session, net::Connection& connection) {
    const Json& skins = database_.rawTable("customSkins");
    const PlayerRecord& record = database_.progress(session.userId);

    ByteWriter w;
    w.u8(static_cast<std::uint8_t>(net::ServerMessage::SkinCatalog));
    // Advisory only: it decides whether the takedown button is drawn, and
    // every delete is re-checked here regardless of what the client believes.
    w.boolean(session.admin);
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
        world_.ensure<PlayerVisuals>(session.entity).renderFlags = record.renderFlags;
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

void GameServer::handleGuildSquadAll(Session& session, net::Connection& connection) {
    if (!session.authenticated()) return;
    if (guildNameForUser(session.username).empty()) {
        sendNotice(connection, net::NoticeSeverity::Warning, "You are not in a guild.");
        return;
    }
    // This build has no squads, so the reference's own "no squad" branch is the
    // whole answer -- its getOrCreateSquad returns null here and it says this.
    sendNotice(connection, net::NoticeSeverity::Warning,
               "Only your squad leader can invite guildmates into the squad.");
}

void GameServer::handleGuildInviteToSquad(Session& session, net::Connection& connection,
                                          ByteReader& reader) {
    const std::string raw = reader.str();
    if (!reader.ok() || !session.authenticated()) return;

    const std::string target = trimmed(raw);
    const std::string guildName = guildNameForUser(session.username);
    if (guildName.empty() ||
        guildMemberIndex(database_.storedTable("guilds")[guildName], target) < 0) {
        sendNotice(connection, net::NoticeSeverity::Warning, target + " is not in your guild.");
        return;
    }
    if (connectionForUser(target) == nullptr) {
        sendNotice(connection, net::NoticeSeverity::Warning, target + " is offline.");
        return;
    }
    sendNotice(connection, net::NoticeSeverity::Warning, "Failed to create a squad.");
}

void GameServer::handleRespawn(Session& session) {
    if (!session.authenticated()) return;
    if (session.playing() && world_.isAlive(session.entity)) {
        Health* health = world_.tryGet<Health>(session.entity);
        if (health && health->alive()) return;   // not actually dead
        despawnPlayer(session, false);
    }
    spawnPlayer(session);
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
// Player lifecycle
// ---------------------------------------------------------------------------

Entity GameServer::spawnPlayer(Session& session) {
    // Where a player appears is a property of the MAP, not of the player.
    // Level deliberately does not enter into it: picking a zone by tier reads
    // as if a high-level flower should start in high-tier ground, and what it
    // actually does is drop everyone into the mythic band in the middle of the
    // world, which nothing can walk out of.
    Vec2 spawn;
    if (session.spawnBiome.empty() ||
        !mapData_.spawnInBiome(session.spawnBiome, rng_, *terrain_, spawn)) {
        spawn = mapData_.defaultSpawn(rng_, *terrain_);
    }

    const Entity entity = world_.create();
    world_.add<PlayerTag>(entity);
    world_.add<Transform>(entity, Transform{spawn, 0.0});
    world_.add<Motion>(entity);
    world_.add<Knockback>(entity);
    world_.add<Faction>(entity, Faction{Team::Players, false});
    world_.add<PlayerInput>(entity);
    world_.add<PlayerLocation>(entity);
    world_.add<PlayerModifiers>(entity);
    world_.add<PlayerVisuals>(entity);
    world_.add<PlayerSkillTree>(entity);
    world_.add<Loadout>(entity);
    world_.add<PetalRing>(entity);
    world_.add<HitCooldowns>(entity);
    world_.add<Afflictions>(entity);
    // The nameplate carries the flower's name, which is what the title screen
    // asked for; the account name stays on the session for chat and for saves.
    world_.add<PlayerAccount>(entity,
                              PlayerAccount{session.userId,
                                            session.displayName.empty() ? session.username
                                                                        : session.displayName,
                                            session.connection, session.admin});

    const PlayerRecord& record = database_.progress(session.userId);
    applyAccountToEntity(record, entity);

    world_.add<NetId>(entity, NetId{netIds_.next()});
    Replicated replicated;
    replicated.kind = net::EntityKind::Player;
    world_.add<Replicated>(entity, replicated);

    world_.bindName(entity, "conn:" + std::to_string(session.connection));

    session.entity = entity;
    session.stage = SessionStage::Playing;
    // A fresh body has a death of its own still to announce.
    session.deathReported = false;
    return entity;
}

void GameServer::applyAccountToEntity(const PlayerRecord& record, Entity entity) {
    const LevelProgress progress = levelFromTotalXp(record.totalXp);

    PlayerProgress& state = world_.ensure<PlayerProgress>(entity);
    state.totalXp = record.totalXp;
    state.level = progress.level;
    state.stars = record.stars;

    // Cosmetic skin bits are account data. The temporary glitch bit stays on
    // PlayerVisuals and is intentionally not reset by a loadout edit.
    world_.ensure<PlayerVisuals>(entity).renderFlags = record.renderFlags;

    // The tree is copied onto the body so the tick never reaches into storage.
    // Every path that changes it -- login, respawn, buying a tier, a reset --
    // comes back through here, which is what keeps the two in step.
    world_.ensure<PlayerSkillTree>(entity).skills = record.skills;

    Body& body = world_.ensure<Body>(entity);
    body.radius = playerRadiusForLevel(progress.level);
    body.mass = 1.0;

    Health& health = world_.ensure<Health>(entity);
    const double previousFraction = health.max > 0 ? health.current / health.max : 1.0;
    health.max = maxHealthForLevel(progress.level) * record.skills.statScale(SkillId::PlayerHealth);
    // Preserve the FRACTION across a max-health change, so levelling up mid
    // fight neither heals you to full nor leaves you proportionally worse off.
    health.current = health.max * clamp(previousFraction, 0.0, 1.0);
    if (health.current <= 0) health.current = health.max;
    health.invulnerableUntilMillis = monotonicMillis() + kRespawnInvulnerabilitySeconds * 1000.0;

    Loadout& loadout = world_.ensure<Loadout>(entity);
    for (std::size_t i = 0; i < kLoadoutSlots; ++i) {
        std::uint16_t index = kNoPetal;
        Rarity rarity = Rarity::Common;
        if (i < record.loadout.size() && record.loadout[i].has_value()) {
            const StoredItem& item = *record.loadout[i];
            index = content().petalIndex(item.petalType);
            // A stored petal this build no longer has leaves the slot empty
            // rather than resolving to whatever index 0 happens to be.
            if (index == kInvalidIndex) index = kNoPetal;
            rarity = item.rarity;
        }
        loadout.slots[i].configIndex = index;
        loadout.slots[i].rarity = rarity;
        loadout.slots[i].broken = false;
        loadout.slots[i].reloadReadyAtMillis = 0;
    }
}

void GameServer::persistPlayer(const Session& session) {
    if (!session.playing() || !world_.isAlive(session.entity)) return;
    const PlayerProgress* progress = world_.tryGet<PlayerProgress>(session.entity);
    if (!progress) return;

    PlayerRecord& record = database_.progress(session.userId);
    record.totalXp = progress->totalXp;
    record.stars = progress->stars;
    database_.markDirty();
}

void GameServer::despawnPlayer(Session& session, bool persist) {
    if (session.entity == NULL_ENTITY) return;
    if (persist) persistPlayer(session);

    // The petals belong to the body, not the account, so they go with it.
    if (const Loadout* loadout = world_.tryGet<Loadout>(session.entity)) {
        for (const Entity petal : loadout->spawned) commands_.destroy(petal);
    }
    commands_.destroy(session.entity);

    session.entity = NULL_ENTITY;
    session.stage = SessionStage::Authenticated;
    views_[session.connection].reset();
}

} // namespace flr
