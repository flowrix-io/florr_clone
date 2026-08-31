#include "server/game_server.h"

#include <algorithm>
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

/// Reads a stack count out of the record's inventory.
int inventoryCount(const PlayerRecord& record, std::uint16_t petalIndex, Rarity rarity) {
    return record.itemCount(rarity, inventoryKey(petalIndex));
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
    terrain_->generate(config.worldSeed);

    movement_ = std::make_unique<MovementSystem>();
    // The AI caches queries against one world and wanders from its own
    // stream, so it takes both at construction rather than per call.
    mobAi_ = std::make_unique<MobAiSystem>(world_, config.worldSeed ^ 0x9E3779B9ull);
    petals_ = std::make_unique<PetalSystem>();
    combat_ = std::make_unique<CombatSystem>();
    spawning_ = std::make_unique<SpawnSystem>();
    loot_ = std::make_unique<LootSystem>();

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
        if (world_.has<NetId>(e)) {
            const Transform* transform = world_.tryGet<Transform>(e);
            events_.killed(world_.get<NetId>(e).value, transform ? transform->position : Vec2{});
        }
        // A player's body is kept but reset rather than destroyed: the session
        // still owns it and the client is still watching through it.
        if (world_.has<PlayerTag>(e)) {
            if (Session* session = sessionForEntity(e)) {
                persistPlayer(*session);
                if (net::Connection* connection = listener_.find(session->connection)) {
                    ByteWriter w;
                    w.u8(static_cast<std::uint8_t>(net::ServerMessage::Died));
                    w.str("");
                    w.u32(0);
                    w.u32(tick_);
                    connection->send(w);
                }
            }
            world_.remove<Dead>(e);
            if (Health* health = world_.tryGet<Health>(e)) {
                health->current = 0;
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
    sendProfile(session, connection);
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
        sendAuthResult(connection, net::AuthStatus::BadCredentials, "", "", "Wrong username or password.");
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
    sendProfile(session, connection);
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
    sendProfile(session, connection);
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
    if (!reader.ok()) return;
    if (!session.authenticated()) return;
    if (session.playing()) return;

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
    const int count = reader.u8();
    if (!reader.ok() || !session.authenticated()) return;

    ByteWriter w;
    w.u8(static_cast<std::uint8_t>(net::ServerMessage::CraftResult));

    PlayerRecord& record = database_.progress(session.userId);
    const bool valid = count == kCraftBatch && rarity != Rarity::Apex &&
                       petalIndex < content().petalCount();
    if (!valid || !takeFromInventory(record, petalIndex, rarity, kCraftBatch)) {
        w.boolean(false);
        w.u16(petalIndex);
        w.u8(static_cast<std::uint8_t>(rarity));
        w.str("Not enough petals to craft.");
        connection.send(w);
        return;
    }

    const bool success = rng_.chance(craftSuccessChance(rarity));
    if (success) {
        giveToInventory(record, petalIndex, upgradeRarity(rarity), 1);
    } else {
        // A failed craft is not a total loss: most of the batch survives, which
        // keeps the top tiers a gamble rather than a wall.
        giveToInventory(record, petalIndex, rarity, kCraftBatch - 2);
    }
    database_.markDirty();

    w.boolean(success);
    w.u16(petalIndex);
    w.u8(static_cast<std::uint8_t>(success ? upgradeRarity(rarity) : rarity));
    w.str(success ? "" : "The craft failed.");
    connection.send(w);
    sendProfile(session, connection);
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
    const Vec2 centre{kWorldHalf, kWorldHalf};
    const Vec2 spawn = terrain_->findOpenSpawn(rng_, centre, 600.0);

    const Entity entity = world_.create();
    world_.add<PlayerTag>(entity);
    world_.add<Transform>(entity, Transform{spawn, 0.0});
    world_.add<Motion>(entity);
    world_.add<Knockback>(entity);
    world_.add<Faction>(entity, Faction{Team::Players, false});
    world_.add<PlayerInput>(entity);
    world_.add<PlayerLocation>(entity);
    world_.add<PlayerModifiers>(entity);
    world_.add<Loadout>(entity);
    world_.add<PetalRing>(entity);
    world_.add<HitCooldowns>(entity);
    world_.add<Afflictions>(entity);
    world_.add<PlayerAccount>(entity,
                              PlayerAccount{session.userId, session.username, session.connection,
                                            session.admin});

    const PlayerRecord& record = database_.progress(session.userId);
    applyAccountToEntity(record, entity);

    world_.add<NetId>(entity, NetId{netIds_.next()});
    Replicated replicated;
    replicated.kind = net::EntityKind::Player;
    world_.add<Replicated>(entity, replicated);

    world_.bindName(entity, "conn:" + std::to_string(session.connection));

    session.entity = entity;
    session.stage = SessionStage::Playing;
    return entity;
}

void GameServer::applyAccountToEntity(const PlayerRecord& record, Entity entity) {
    const LevelProgress progress = levelFromTotalXp(record.totalXp);

    PlayerProgress& state = world_.ensure<PlayerProgress>(entity);
    state.totalXp = record.totalXp;
    state.level = progress.level;
    state.stars = record.stars;

    Body& body = world_.ensure<Body>(entity);
    body.radius = playerRadiusForLevel(progress.level);
    body.mass = 1.0;

    Health& health = world_.ensure<Health>(entity);
    const double previousFraction = health.max > 0 ? health.current / health.max : 1.0;
    health.max = maxHealthForLevel(progress.level);
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
