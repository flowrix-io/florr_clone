// A simulation server of a sharded game: its players are sent to its port by
// the gateway, and their rows are on loan. See server/cluster/shard.h and
// cpp/docs/ARCHITECTURE.md, "Sharding".

#include "server/cluster/shard.h"

#include <algorithm>
#include <cmath>
#include <cstdio>
#include <limits>

#include "server/auto_update.h"
#include "server/cluster/row_merge.h"
#include "server/account_limits.h"
#include "server/crypto.h"
#include "shared/net/websocket.h"
#include "server/game_server_internal.h"
#include "server/systems/dungeons.h"
#include "server/systems/loot.h"
#include "server/systems/mode_spawning.h"
#include "server/systems/npcs.h"
#include "server/systems/petals.h"
#include "server/systems/spawning.h"
#include "server/text.h"
#include "shared/game/config.h"

namespace flix {

using cluster::ClientInfo;
using cluster::FlowerState;
using cluster::ToGateway;
using cluster::ToServer;

namespace {

constexpr double kStatsIntervalMillis = 1000.0;
constexpr double kMaxDialDelayMillis = 10000.0;
/// A refusal is not a fault that passes in a moment.
constexpr double kRefusedDialMillis = 15000.0;
/// How long a stopping server waits for the gateway to have read it out.
constexpr double kShardDrainMillis = 2000.0;
/// A pad into a biome nobody is simulating says so, and then leaves the
/// flower on it alone for a while.
constexpr double kShutPadMillis = 5000.0;

ByteWriter begin(ToGateway message) {
    ByteWriter w;
    w.u8(static_cast<std::uint8_t>(message));
    return w;
}

} // namespace

// ---------------------------------------------------------------------------
// Starting, the link, and stopping
// ---------------------------------------------------------------------------

bool GameServer::startShard(std::string& errorOut) {
    if (config_.clusterSecret.empty()) {
        errorOut = "a sharded game needs a cluster secret";
        return false;
    }
    hosted_.all = false;
    hosted_.realm.fill(false);
    for (int i = 0; i < kMaxRealms; ++i) {
        hosted_.realm[static_cast<std::size_t>(i)] = ubiquitousRealm(static_cast<Realm>(i));
    }
    shard_ = std::make_unique<Shard>(*this);
    // Every server takes its own players' sockets: the gateway relays none.
    shard_->door = std::make_unique<Shard::Door>(*this);
    net::Listener& door = shard_->door->listener;
    door.certPath = config_.certPath;
    door.keyPath = config_.keyPath;
    door.webRoot = config_.webRoot;
    door.bindHost = config_.bindHost;
    if (!door.start(config_.port, errorOut)) {
        errorOut = "port " + std::to_string(config_.port) + ": " + errorOut;
        return false;
    }
    if (!shard_->journal.open(config_.leaseJournalPath, errorOut)) return false;
    shard_->dialer.maxFrameBytes = cluster::kLinkMaxFrame;
    // The gateway's game port, as a WebSocket at /link, plainly whatever
    // certificate the port has.
    shard_->dialer.serverLink = true;
    shard_->dialer.beforeWrite = [this] { shSendRows(); };
    // The rows go into the lease journal, and onto the link, before any byte
    // that shows them leaves for a client: the sessions' frames are drained
    // to their sockets only after this.
    listener_.beforeWrite = [this] { shSendRows(); };
    return true;
}

bool GameServer::linked() const { return shard_ && shard_->welcomed; }

void GameServer::shSend(const ByteWriter& message) {
    if (shard_->welcomed) shard_->dialer.send(shard_->cipher.seal(message));
}

void GameServer::shService(int timeoutMillis) {
    Shard& s = *shard_;
    const double now = monotonicMillis();
    const auto state = s.dialer.state();
    if (state == net::Dialer::State::Idle || state == net::Dialer::State::Failed) {
        if (now >= s.nextDialMillis) {
            s.nextDialMillis = now + s.dialDelayMillis;
            s.dialDelayMillis = std::min(kMaxDialDelayMillis, s.dialDelayMillis * 2.0);
            std::string error;
            s.lastHeardMillis = now;
            if (!s.dialer.connect(config_.gatewayHost, config_.gatewayPort, error)) {
                std::fprintf(stderr, "[cluster] %s\n", error.c_str());
            }
        }
    }
    // Two sets of sockets and one wait, as on the gateway: the short one on
    // the players', whose input should not sit behind the link's silence.
    s.dialer.poll(*this->shard_, 0);
    if (s.door) s.door->listener.poll(*s.door, std::min(timeoutMillis, 1));
    s.dialer.poll(*this->shard_, 0);
    if (s.dialer.state() == net::Dialer::State::Connecting ||
        s.dialer.state() == net::Dialer::State::Connected) {
        if (now - s.lastHeardMillis > cluster::kLinkSilenceMillis) {
            s.dialer.disconnect();
            shLinkLost("it went silent");
        }
    }
    // The sessions: a close to report, a frame queued for a socket.
    listener_.poll(*this, 0);
    s.journal.sync(now);
}

void GameServer::shFlush() {
    shReturnIdle();
    listener_.flush();
    shSendRows();
    shard_->dialer.flush();
    if (shard_->door) shard_->door->listener.flush();
}

void GameServer::shLinkOpened(net::Connection&) {
    Shard& s = *shard_;
    s.lastHeardMillis = monotonicMillis();
    s.cipher = cluster::LinkCipher{};
    s.greeting = linkGreeting();
    s.greeting.copy = !config_.copyPath.empty();
    s.greeting.local = config_.localShard;
    s.greeting.publicHost = config_.publicHost;
    s.greeting.publicPort = config_.publicPort;
    s.greeting.port = config_.port;
    ByteWriter w = begin(ToGateway::Hello);
    s.greeting.write(w);
    s.dialer.send(w);
}

void GameServer::shLinkLost(const std::string& reason) {
    Shard& s = *shard_;
    if (s.welcomed) std::printf("[cluster] lost the gateway (%s)\n", reason.c_str());
    s.welcomed = false;
    s.slot = 0;
    s.cipher = cluster::LinkCipher{};
    // Without the gateway nobody here can be answered for: every client goes
    // back to it to sign in again (and waits there for it, if it is the one
    // that is gone).
    if (s.door) s.door->listener.each([](net::Connection& c) { c.closeGracefully(); });
    if (s.door) s.door->sockets.clear();
    s.expected.clear();
    // Nothing here is ours any more. Every row went back over the link or is
    // in the lease journal, which goes back the moment the link is up again;
    // the biomes are about to be dealt out again.
    std::vector<net::ConnectionId> all;
    for (const auto& entry : sessions_) all.push_back(entry.first);
    for (const net::ConnectionId id : all) {
        if (Session* session = sessionFor(id)) session->lease = 0;
        endSession(id);
        listener_.abandon(id);
    }
    for (const auto& [userId, client] : s.leased) database_.forgetProgress(userId);
    s.leased.clear();
    while (!s.hosted.empty()) {
        const Shard::Hosted hosted = s.hosted.back();
        s.hosted.pop_back();
        for (const Realm realm : hosted.realms) {
            hosted_.realm[realmIndex(realm)] = false;
            shClearRealm(realm);
        }
    }
    shHostedChanged();
    commands_.flush();
    database_.drainReplica([](const std::string&, const std::string&) {},
                           [](const std::string&, const std::string&) {});
}

bool GameServer::shDraining() {
    Shard& s = *shard_;
    if (!s.welcomed) return false;
    if (s.drainUntilMillis < 0) {
        s.drainUntilMillis = monotonicMillis() + kShardDrainMillis;
        std::printf("[cluster] handing everything back\n");
        std::vector<std::string> names;
        for (const Shard::Hosted& hosted : s.hosted) names.push_back(hosted.biome);
        for (const std::string& name : names) shRelease(name);
        // And whoever was in a realm every server has its own of.
        for (auto& entry : sessions_) {
            if (entry.second.lease == 0) continue;
            if (entry.second.entity != NULL_ENTITY) dropBody(entry.second);
        }
        shFlush();
    }
    shService(0);
    shFlush();
    return s.dialer.pendingBytes() > 0 && monotonicMillis() < s.drainUntilMillis;
}

void GameServer::shLinkMessage(ByteReader& frame) {
    Shard& s = *shard_;
    s.lastHeardMillis = monotonicMillis();
    std::vector<std::byte> plain;
    if (!s.cipher.open(frame.rest(), frame.remaining(), plain)) {
        std::fprintf(stderr, "[cluster] a frame from the gateway does not open; dialling again\n");
        s.dialer.disconnect();
        shLinkLost("its frames do not open");
        return;
    }
    ByteReader reader(plain);
    const auto message = static_cast<ToServer>(reader.u8());
    if (!s.welcomed) {
        switch (message) {
            case ToServer::Challenge: {
                if (s.cipher.started()) return;
                const std::string nonce = reader.str();
                const std::string proof = reader.str();
                if (!reader.ok() ||
                    !crypto::constantTimeEquals(
                        proof, cluster::linkProof(config_.clusterSecret, "gateway", s.greeting.digest(), nonce))) {
                    std::fprintf(stderr, "[cluster] the gateway does not hold our cluster key\n");
                    s.dialer.disconnect();
                    return;
                }
                ByteWriter w = begin(ToGateway::Proof);
                w.str(cluster::linkProof(config_.clusterSecret, "server", nonce, s.greeting.digest()));
                s.dialer.send(w);
                s.cipher.start(config_.clusterSecret, s.greeting.digest(), nonce, false);
                return;
            }
            case ToServer::Welcome: {
                // Said by nobody who has not proven the key: unsealed, it is
                // somebody else's word.
                if (!s.cipher.started()) return;
                s.slot = reader.u8();
                const std::int64_t mazeDay = reader.i64();
                const std::uint64_t taken = reader.u64();
                s.gatewayPublicHost = reader.str();
                s.gatewayPublicPort = reader.u16();
                s.gatewayDirectPort = reader.u16();
                if (!reader.ok()) return;
                // Straight, it is wherever this server dials it -- unless that
                // is this machine, which the client knows by its own name.
                const std::string& dialled = config_.gatewayHost;
                const bool loopback = dialled.rfind("127.", 0) == 0 || dialled == "localhost" || dialled == "::1";
                s.gatewayDirectHost = loopback ? std::string() : dialled;
                s.welcomed = true;
                s.dialDelayMillis = 250;
                netIds_.startFrom(cluster::netIdBase(s.slot));
                setActiveMazeDay(mazeDay);
                std::printf("[cluster] joined the gateway at %s:%u\n", config_.gatewayHost.c_str(),
                            static_cast<unsigned>(config_.gatewayPort));
                shRecover(taken);
                return;
            }
            case ToServer::Refused: {
                const std::string why = reader.str();
                std::fprintf(stderr, "[cluster] the gateway refused this server: %s\n", why.c_str());
                if (config_.membership.role == cluster::Membership::Role::Shard) {
                    // Nobody but this server's own operator can put it right,
                    // and a process that exits over and over is no easier to.
                    s.nextDialMillis = monotonicMillis() + kRefusedDialMillis;
                    s.dialer.disconnect();
                    return;
                }
                // Another build is on its way to this box, or should be: the
                // supervisor starts whatever is there now. Dialling again as
                // the same build would be refused again.
                s.refused = true;
                exitCode_ = kRestartExit;
                stop();
                return;
            }
            case ToServer::Leave:
                if (s.cipher.started()) shLeave();
                return;
            default: return;
        }
    }

    switch (message) {
        case ToServer::CopyBegin:
        case ToServer::CopyRows:
        case ToServer::CopyComplete:
            shCopyMessage(static_cast<std::uint8_t>(message), reader);
            break;
        case ToServer::Deliver: {
            // The gateway's word to a client of ours, behind what this server
            // has queued for it.
            const net::ConnectionId id = reader.u32();
            net::Connection* client = reader.ok() ? listener_.find(id) : nullptr;
            if (client != nullptr && reader.remaining() > 0) client->send(reader.rest(), reader.remaining());
            break;
        }
        case ToServer::Expect: {
            const net::ConnectionId id = reader.u32();
            const std::string ticket = reader.str();
            Session* session = reader.ok() ? sessionFor(id) : nullptr;
            if (session == nullptr || ticket.empty()) break;
            session->expected = true;
            session->transit.clear();
            session->transitBytes = 0;
            s.expected[ticket] = Shard::Ticket{id, monotonicMillis() + cluster::kAttachPatienceMillis};
            break;
        }
        case ToServer::Handled: {
            const net::ConnectionId id = reader.u32();
            Session* session = reader.ok() ? sessionFor(id) : nullptr;
            if (session == nullptr) break;
            session->awaitingGateway = false;
            // What it sent behind the request, in order, until another such.
            while (true) {
                session = sessionFor(id);
                if (session == nullptr || session->awaitingGateway || session->heldForGateway.empty()) break;
                const std::vector<std::byte> frame = std::move(session->heldForGateway.front());
                session->heldForGateway.pop_front();
                ByteReader held(frame);
                shClientFrame(id, held);
            }
            break;
        }
        case ToServer::RowsTaken: {
            const std::uint64_t seq = reader.u64();
            if (reader.ok()) s.journal.taken(seq);
            break;
        }
        case ToServer::Leave: shLeave(); break;
        case ToServer::Update: {
            const double delay = reader.f64();
            // Its own box's build: a server started by hand on the gateway's
            // runs the files the gateway is replacing.
            if (!reader.ok() || config_.membership.role != cluster::Membership::Role::Shard) break;
            updateRestartDelayMillis_ = delay;
            if (!autoupdate::start(autoupdate::defaultUrl())) {
                std::fprintf(stderr, "[cluster] could not update: %s\n", autoupdate::lastStatus().c_str());
            }
            break;
        }
        case ToServer::Client: {
            const net::ConnectionId id = reader.u32();
            if (reader.ok()) shClient(id, reader);
            break;
        }
        case ToServer::ClientGone: {
            const net::ConnectionId id = reader.u32();
            Session* session = reader.ok() ? sessionFor(id) : nullptr;
            if (session == nullptr) break;
            // Its body out, its row settled and home, and only then forgotten.
            departSquad(*session, nullptr, squadDisplayName(squadIdOf(*session)));
            dropBody(*session);
            if (session->lease != 0) shReturnLease(*session, nullptr);
            // What it was still to be told -- a redirect home, say -- before
            // the connection is let go of, and the socket with it.
            listener_.flush();
            if (Session* still = sessionFor(id)) shCloseDoor(*still);
            listener_.abandon(id);
            endSession(id);
            break;
        }
        case ToServer::ClientFrame: {
            const net::ConnectionId id = reader.u32();
            net::Connection* connection = listener_.find(id);
            Session* session = sessionFor(id);
            if (connection == nullptr || session == nullptr || reader.remaining() == 0) break;
            const auto kind = static_cast<net::ClientMessage>(reader.rest()[0]);
            // Without a row on loan there is no account here to act on: only
            // what a squad or an admin console asks of a server it is not on.
            if (session->lease == 0 && kind != net::ClientMessage::Chat &&
                kind != net::ClientMessage::AdminTools &&
                kind != net::ClientMessage::GuildSquadAll &&
                kind != net::ClientMessage::GuildInviteToSquad) {
                break;
            }
            ByteReader frame(reader.rest(), reader.remaining());
            onMessage(*connection, frame);
            break;
        }
        case ToServer::Grant: shGrant(reader); break;
        case ToServer::RowPatch: shPatch(reader); break;
        case ToServer::Fence: {
            const net::ConnectionId id = reader.u32();
            const std::uint32_t fence = reader.u32();
            if (!reader.ok()) break;
            Session* session = sessionFor(id);
            const bool atMarket = session != nullptr && shAtMarket(*session);
            shReturnIdle();
            // Everything asked for before the fence, on the link ahead of its
            // answer: the rows, and the replies.
            listener_.flush();
            shSendRows();
            ByteWriter w = begin(ToGateway::FenceAck);
            w.u32(id);
            w.u32(fence);
            w.boolean(atMarket);
            shSend(w);
            break;
        }
        case ToServer::Account: {
            const Json row = Json::parseOrNull(reader.blob());
            if (!reader.ok() || !row.isObject()) break;
            const Account account = parseAccountRecord(row, row["username"].asString());
            database_.putAccount(account);
            break;
        }
        case ToServer::Table: {
            const std::string key = reader.str();
            const std::string text = reader.blob();
            if (reader.ok()) database_.putTable(key, Json::parseOrNull(text), false);
            break;
        }
        case ToServer::Host: shHost(reader); break;
        case ToServer::Release: {
            const std::string biome = reader.str();
            if (reader.ok()) shRelease(biome);
            break;
        }
        case ToServer::Reachable:
            for (bool& open : s.reachable) open = reader.boolean();
            break;
        case ToServer::Restart:
            exitCode_ = kRestartExit;
            stop();
            break;
        case ToServer::BotRaid: triggerBotRaid(clockMillis_); break;
        case ToServer::SquadLeaving: {
            const net::ConnectionId id = reader.u32();
            const std::string to = reader.str();
            if (reader.ok()) shSquadLeaving(id, to);
            break;
        }
        case ToServer::Squad: {
            const cluster::SquadState squad = cluster::SquadState::read(reader);
            if (reader.ok()) shSquadArrived(squad);
            break;
        }
        default: break;
    }
}

void GameServer::shSendRows() {
    Shard& s = *shard_;
    ByteWriter rows;
    std::uint16_t count = 0;
    database_.drainReplica(
        [&](const std::string& userId, const std::string& text) {
            // Only what is on loan. A row this server has no loan for is one
            // it has no business having touched, and must never be the copy
            // that wins.
            const auto lent = s.leased.find(userId);
            const Session* session = lent != s.leased.end() ? sessionFor(lent->second) : nullptr;
            if (session == nullptr || session->lease == 0) return;
            s.journal.changed(userId, session->lease, text);
            rows.str(userId);
            rows.u32(session->lease);
            rows.u32(session->patchAck);
            rows.blob(text);
            ++count;
        },
        [&](const std::string& key, const std::string& text) {
            ByteWriter w = begin(ToGateway::Table);
            w.str(key);
            w.blob(text);
            shSend(w);
        });
    if (count == 0) return;
    // On this server's disk before any byte that shows them leaves; on the
    // link for the gateway, which says when they are on its own.
    s.journal.flush();
    ByteWriter w = begin(ToGateway::Rows);
    w.u64(s.journal.lastSeq());
    w.u16(count);
    w.raw(rows.data(), rows.size());
    shSend(w);
}

// ---------------------------------------------------------------------------
// Clients and their rows
// ---------------------------------------------------------------------------

void GameServer::shClient(net::ConnectionId id, ByteReader& reader) {
    const ClientInfo info = ClientInfo::read(reader);
    if (!reader.ok()) return;
    Session* session = sessionFor(id);
    if (session == nullptr) {
        net::Connection& connection =
            listener_.adopt(id, info.address, [this, id](const std::byte* data, std::size_t size) {
                shDeliver(id, data, size);
            });
        onConnect(connection);
        session = sessionFor(id);
        session->clientAddress = info.address;
        session->stage = SessionStage::Authenticated;
    }
    const bool otherAccount = session->userId != info.userId;
    if (otherAccount && !session->userId.empty()) {
        // Never in practice -- an account change calls everything in first --
        // but a body must not pass to another account on the strength of that.
        if (session->entity != NULL_ENTITY) dropBody(*session);
        if (session->lease != 0) shReturnLease(*session, nullptr);
        departSquad(*session, nullptr, squadDisplayName(squadIdOf(*session)));
    }
    session->userId = info.userId;
    session->username = info.username;
    session->elsewhereBiome = info.elsewhere;
    if (session->lease == 0) {
        session->displayName = info.displayName;
        session->spawnChoice = info.spawnChoice;
    }
    const bool wasAdmin = effectiveAdmin(*session);
    session->admin = info.admin;
    session->adminTier = info.adminTier;
    if (info.grantTier != kNotAnAdmin) {
        tempAdmins_[id] = {info.grantedBy, clockMillis_, info.grantTier};
    } else {
        tempAdmins_.erase(id);
    }
    if (wasAdmin && !effectiveAdmin(*session) && session->controlling != 0) {
        endControl(*session, "Control ended: your admin access ended.", true);
    }
}

void GameServer::shGrant(ByteReader& reader) {
    Shard& s = *shard_;
    const net::ConnectionId id = reader.u32();
    const std::uint32_t lease = reader.u32();
    std::string row = reader.blob();
    const std::uint32_t revision = reader.u32();
    const double oracle = reader.f64();
    const double trader = reader.f64();
    const FlowerState state = FlowerState::read(reader);
    Session* session = sessionFor(id);
    net::Connection* connection = listener_.find(id);
    if (!reader.ok() || session == nullptr || connection == nullptr) return;
    s.journal.granted(session->userId, lease, row);
    database_.putProgressText(session->userId, std::move(row), false);
    s.leased[session->userId] = id;
    session->lease = lease;
    session->patchAck = 0;
    session->profileRevision = revision;
    session->profileShadow = Session::ProfileShadow{};
    session->toldState.clear();
    session->elsewhereBiome.clear();
    oracleReadyAt_[session->userId] = clockMillis_ + oracle;
    traderReadyAt_[session->userId] = clockMillis_ + trader;
    shEnter(*session, *connection, state);
    // Refused at the door: the row goes straight home.
    if (session->lease != 0 && !session->playing()) shReturnLease(*session, nullptr);
}

void GameServer::shEnter(Session& session, net::Connection& connection, const FlowerState& state) {
    session.displayName = state.displayName;
    session.spawnChoice = state.spawnChoice;
    session.prestige = state.prestige;
    session.trialFloor = 0;
    session.trialRealm = Realm::Overworld;
    session.adminArenaAdmitted = state.arenaAdmitted;
    session.adminArenaHasReturn = state.arenaReturn;
    session.adminArenaReturnRealm = state.arenaReturnRealm;
    session.adminArenaReturnPosition = state.arenaReturnPosition;
    session.adminArenaReturnChoice = state.arenaReturnChoice;

    if (state.how != FlowerState::How::Walk) {
        if (state.trialFloor > 0) {
            for (int i = 0; i < kTrialRealmCount; ++i) {
                if (trials_[static_cast<std::size_t>(i)].phase != TrialPhase::Idle) continue;
                session.trialFloor = state.trialFloor;
                session.trialRealm = trialRealm(i);
                break;
            }
            if (session.trialFloor == 0) {
                sendNotice(connection, net::NoticeSeverity::Bad,
                           "Every Trial Grounds instance is currently in use. Please try again.");
                return;
            }
        }
        if (!hosted_.hosts(spawnRealmFor(session))) {
            // The biome left while this flower was on its way to it.
            FlowerState again = state;
            again.realm = spawnRealmFor(session);
            shReturnLease(session, &again);
            return;
        }
        if (spawnPlayer(session) == NULL_ENTITY) {
            sendNotice(connection, net::NoticeSeverity::Bad, "Could not find a spawn point.");
            return;
        }
        if (state.viewWidth > 0) {
            world_.get<PlayerLocation>(session.entity).viewport = claimableViewport(
                world_, session.entity, content(), state.viewWidth, state.viewHeight);
        }
        views_[session.connection].reset();
        if (state.how == FlowerState::How::Join) {
            welcomeIntoWorld(session, connection);
            return;
        }
        sendRealmChange(session, world_.get<Transform>(session.entity).position);
        sendRiftState(connection);
        if (state.dead) onPlayerRevived(session.entity, NULL_ENTITY);
        sendProfile(session, connection);
        return;
    }

    if (!hosted_.hosts(state.realm)) {
        shReturnLease(session, &state);
        return;
    }
    session.realm = state.realm;
    session.arena.reset();
    session.eventKit.reset();
    session.eventRestricted.reset();
    if (state.realm == Realm::Arena) session.arena = startArenaRun(database_.progress(session.userId));
    if (state.realm == kAdminArenaRealm) applyHostedKit(session);
    // The hosted arena's walls are only known here: whoever sent the flower in
    // had a copy of the last one saved.
    const Vec2 at = state.realm == kAdminArenaRealm
                        ? terrain_->findOpenSpawn(rng_, terrain_->spawnPoint(state.realm), kTileSize,
                                                  state.realm)
                        : terrain_->resolveCircle(state.position, kPlayerBaseRadius, state.realm);
    const Entity body = createPlayerBody(session, state.realm, at);
    session.entity = body;
    session.stage = SessionStage::Playing;
    session.deathReported = false;
    session.splitReadyAtMillis = clockMillis_ + state.splitLeft;
    session.lastInputSequence = state.inputSequence;

    petals_->restoreRing(world_, content(), body, state.ring, clockMillis_);
    Health& health = world_.get<Health>(body);
    health.current = health.max * clamp(state.health, 0.0, 1.0);
    health.invulnerableUntilMillis =
        state.god ? std::numeric_limits<double>::infinity()
                  : monotonicMillis() + std::max(0.0, state.invulnerableLeft);
    world_.ensure<ShieldState>(body).amount = std::max(0.0, state.shield);
    if (state.mana > 0.0) world_.ensure<ManaPool>(body).current = state.mana;
    world_.get<Transform>(body).angle = state.angle;
    TeleporterState& pads = world_.ensure<TeleporterState>(body);
    pads.pad = -1;
    pads.cooldownUntilMillis = clockMillis_ + kTeleporterCooldownMillis;
    pads.arriving = true;
    if (state.viewWidth > 0) {
        world_.get<PlayerLocation>(body).viewport =
            claimableViewport(world_, body, content(), state.viewWidth, state.viewHeight);
    }
    if (state.phase) setAdminPhase(session, true);
    if (state.dead) {
        world_.get<Health>(body).current = 0;
        world_.add<Dead>(body, Dead{});
        session.deathReported = true;
    }
    // What the same body did here before it went away: see Session::lastBody.
    if (session.lastBody != NULL_ENTITY && session.lastBodyUserId == session.userId) {
        handOverCredit(session.lastBody, body);
    }
    session.lastBody = NULL_ENTITY;
    session.lastBodyUserId.clear();
    sendRealmChange(session, at);
    sendRiftState(connection);
    sendProfile(session, connection);
    enforceSquadBiome(squadIdOf(session));
    if (const Squad* squad = squads_.forMember(squadIdOf(session))) broadcastSquadUpdate(*squad);
}

void GameServer::shReturnLease(Session& session, const FlowerState* onward) {
    Shard& s = *shard_;
    if (session.lease == 0) return;
    // The frames already queued for it first, with the rows behind them.
    listener_.flush();
    shSendRows();
    const std::string row = database_.progressText(session.userId);
    const std::uint64_t seq = s.journal.returned(session.userId, session.lease, row);
    s.journal.flush();
    ByteWriter w = begin(ToGateway::LeaseReturned);
    w.u64(seq);
    w.u32(session.connection);
    w.str(session.userId);
    w.u32(session.lease);
    w.u32(session.patchAck);
    w.blob(row);
    w.u32(session.profileRevision);
    w.f64(oracleWaitMillis(session.userId));
    w.f64(traderWaitMillis(session.userId));
    w.boolean(onward != nullptr);
    if (onward != nullptr) onward->write(w);
    shSend(w);
    s.leased.erase(session.userId);
    database_.forgetProgress(session.userId);
    session.lease = 0;
    session.toldState.clear();
    session.profileShadow = Session::ProfileShadow{};
    clearProfileDue(session);
}

void GameServer::shBroadcastChat(net::ChatChannel channel, const std::string& author,
                                 const std::string& text, std::uint32_t speakerNetId) {
    // Behind the rows: what it says somebody found or made is theirs by then.
    shSendRows();
    ByteWriter w = begin(ToGateway::Chat);
    w.u8(static_cast<std::uint8_t>(channel));
    w.str(author);
    w.str(text);
    w.u32(speakerNetId);
    shSend(w);
}

void GameServer::shNotify(const std::string& type, const std::string& message) {
    shSendRows();
    ByteWriter w = begin(ToGateway::Notification);
    w.str(type);
    w.str(message);
    shSend(w);
}

void GameServer::shTitanForged(const Session& session, std::uint16_t petalIndex) {
    shSendRows();
    ByteWriter w = begin(ToGateway::TitanForged);
    w.str(session.userId);
    w.str(session.username);
    w.u16(petalIndex);
    shSend(w);
}

void GameServer::shAskTitanHolder(const Session& session, std::uint16_t petalIndex) {
    ByteWriter w = begin(ToGateway::TitanHolder);
    w.u32(session.connection);
    w.u16(petalIndex);
    shSend(w);
}

void GameServer::shCreditKill(const std::string& userId, const std::string& mob, Rarity rarity,
                              double stars) {
    ByteWriter w = begin(ToGateway::CreditKill);
    w.str(userId);
    w.str(mob);
    w.u8(static_cast<std::uint8_t>(rarity));
    w.f64(stars);
    shSend(w);
}

void GameServer::shTempAdminEnded(net::ConnectionId id) {
    ByteWriter w = begin(ToGateway::TempAdminEnded);
    w.u32(id);
    shSend(w);
}

void GameServer::shClientClosed(net::ConnectionId id) {
    // Its socket here goes with it, and the gateway ends the session.
    if (Session* session = sessionFor(id)) shCloseDoor(*session);
    ByteWriter w = begin(ToGateway::ClientClose);
    w.u32(id);
    shSend(w);
}

void GameServer::shReturnIdle() {
    std::vector<net::ConnectionId> idle;
    for (const auto& entry : sessions_) {
        if (entry.second.lease != 0 && !entry.second.playing()) idle.push_back(entry.first);
    }
    for (const net::ConnectionId id : idle) {
        if (Session* session = sessionFor(id)) shReturnLease(*session, nullptr);
    }
}

void GameServer::shPatch(ByteReader& reader) {
    const std::string userId = reader.str();
    const std::uint32_t lease = reader.u32();
    const std::uint32_t seq = reader.u32();
    const Json change = Json::parseOrNull(reader.blob());
    if (!reader.ok()) return;
    const auto lent = shard_->leased.find(userId);
    Session* session = lent != shard_->leased.end() ? sessionFor(lent->second) : nullptr;
    if (session == nullptr || session->lease != lease) return;
    session->patchAck = seq;
    // Banked first, as every edit from outside does: the body is the XP and
    // star authority, and what it has earned since is not in the row yet.
    persistPlayer(*session);
    PlayerRecord& record = database_.progress(userId);
    Json value = playerRecordJson(record);
    applyRowDifference(value, change);
    record = parsePlayerRecord(value);
    database_.markDirty();
    adminDbRefreshLive(userId);
}

// ---------------------------------------------------------------------------
// Flowers leaving for another server
// ---------------------------------------------------------------------------

FlowerState GameServer::shCapture(Session& session, FlowerState::How how) {
    FlowerState state;
    state.how = how;
    state.displayName = session.displayName;
    state.spawnChoice = session.spawnChoice;
    state.prestige = session.prestige;
    state.arenaAdmitted = session.adminArenaAdmitted;
    state.arenaReturn = session.adminArenaHasReturn;
    state.arenaReturnRealm = session.adminArenaReturnRealm;
    state.arenaReturnPosition = session.adminArenaReturnPosition;
    state.arenaReturnChoice = session.adminArenaReturnChoice;
    const Entity body = session.entity;
    if (body == NULL_ENTITY || !world_.isAlive(body)) return state;
    if (const Transform* at = world_.tryGet<Transform>(body)) {
        state.realm = at->realm;
        state.position = at->position;
        state.angle = at->angle;
    }
    if (const PlayerLocation* location = world_.tryGet<PlayerLocation>(body)) {
        state.viewWidth = location->viewport.x;
        state.viewHeight = location->viewport.y;
    }
    state.dead = world_.has<Dead>(body);
    if (how != FlowerState::How::Walk) return state;
    if (const Health* health = world_.tryGet<Health>(body)) {
        state.health = health->fraction();
        state.god = std::isinf(health->invulnerableUntilMillis);
        if (!state.god) {
            state.invulnerableLeft =
                std::max(0.0, health->invulnerableUntilMillis - monotonicMillis());
        }
    }
    if (const ShieldState* shield = world_.tryGet<ShieldState>(body)) state.shield = shield->amount;
    if (const ManaPool* mana = world_.tryGet<ManaPool>(body)) state.mana = mana->current;
    if (const PlayerInput* input = world_.tryGet<PlayerInput>(body)) state.phase = input->adminPhase;
    state.splitLeft = std::max(0.0, session.splitReadyAtMillis - clockMillis_);
    state.inputSequence = session.lastInputSequence;
    state.ring = petals_->captureRing(world_, content(), body, clockMillis_);
    return state;
}

void GameServer::crossToServer(Session& session, Realm realm, Vec2 position) {
    net::Connection* connection = listener_.find(session.connection);
    if (!shard_->reachable[realmIndex(realm)]) {
        if (TeleporterState* pads = world_.tryGet<TeleporterState>(session.entity)) {
            pads->pad = -1;
            pads->enteredAtMillis = 0;
            pads->cooldownUntilMillis = clockMillis_ + kShutPadMillis;
        }
        if (connection != nullptr) {
            sendNotice(*connection, net::NoticeSeverity::Warning,
                       "The way to " + biomeLabel(biomeOfRealm(realm)) + " is closed right now.");
        }
        return;
    }
    // One body crosses. A split flower is one person going one way.
    endSplit(session, clockMillis_, false);
    persistPlayer(session);
    // The iris closes over the frame from before the jump, as a pad's does.
    sendTeleported(session.entity);
    FlowerState state = shCapture(session, FlowerState::How::Walk);
    state.realm = realm;
    state.position = position;
    despawnPlayer(session, false);
    shReturnLease(session, &state);
}

bool GameServer::respawnElsewhere(Session& session) {
    if (!shard_ || hosted_.hosts(spawnRealmFor(session))) return false;
    FlowerState state = shCapture(session, FlowerState::How::Fresh);
    state.realm = spawnRealmFor(session);
    // A respawn and not a raising: the far side has nothing to announce.
    state.dead = false;
    if (session.entity != NULL_ENTITY) despawnPlayer(session, false);
    shReturnLease(session, &state);
    return true;
}

// ---------------------------------------------------------------------------
// Biomes coming and going
// ---------------------------------------------------------------------------

void GameServer::shHostedChanged() {
    botBiomesReady_ = false;
    botBiomes_.clear();
    botMapCeiling_ = -1;
}

void GameServer::shHost(ByteReader& reader) {
    Shard& s = *shard_;
    Shard::Hosted hosted;
    hosted.biome = reader.str();
    for (int n = reader.u8(); n > 0 && reader.ok(); --n) {
        hosted.realms.push_back(realmFromByte(reader.u8()));
    }
    const std::string drops = reader.blob();
    if (!reader.ok()) return;
    for (const Realm realm : hosted.realms) hosted_.realm[realmIndex(realm)] = true;
    shHostedChanged();
    restoreBossClock(hosted.biome, clockMillis_);
    bool found = false;
    const Realm hel = worldMaps_.realmOfId("hel", found);
    for (const Realm realm : hosted.realms) {
        if (found && realm == hel) {
            // Whatever its clock said last, wherever it said it.
            sacrificeReadyMillis_ = -1.0;
            savedSacrificeReadyMillis_ = -1.0;
            sacrificeDrop_ = NULL_ENTITY;
        }
        if (realm == kAdminArenaRealm) {
            initHostedArena();
            sizeBroadphases();
        }
    }
    npcs_->placeMissing(world_, *terrain_, content(), clockMillis_);
    shPlaceDrops(drops);
    std::printf("[cluster] simulating %s\n", hosted.biome.c_str());
    s.hosted.push_back(std::move(hosted));
}

void GameServer::shRelease(const std::string& biome) {
    Shard& s = *shard_;
    const auto found = std::find_if(s.hosted.begin(), s.hosted.end(),
                                    [&](const Shard::Hosted& h) { return h.biome == biome; });
    if (found == s.hosted.end()) {
        // Nothing to hand over is still an answer: the gateway is waiting.
        ByteWriter w = begin(ToGateway::Released);
        w.str(biome);
        w.blob({});
        shSend(w);
        return;
    }
    const Shard::Hosted hosted = *found;
    s.hosted.erase(found);
    // Its boss clocks as they are, a standing boss's cooldown handed back.
    if (bossClocksRestored_) {
        spawning_->noteStandingBosses(world_, commands_);
        persistBossClocks();
        shSendRows();
    }
    const auto leaving = [&](Realm realm) {
        return std::find(hosted.realms.begin(), hosted.realms.end(), realm) != hosted.realms.end();
    };
    // Everybody in it, as they stand: they come out on the same ground on
    // another server.
    std::vector<net::ConnectionId> going;
    for (const auto& entry : sessions_) {
        if (entry.second.lease != 0 && entry.second.playing() && leaving(entry.second.realm)) {
            going.push_back(entry.first);
        }
    }
    for (const Realm realm : hosted.realms) hosted_.realm[realmIndex(realm)] = false;
    for (const net::ConnectionId id : going) {
        Session* session = sessionFor(id);
        if (session == nullptr || !session->playing()) continue;
        endSplit(*session, clockMillis_, false);
        // An arena run or a hosted kit belongs to the server that lent it:
        // settled here, taken up afresh there.
        persistPlayer(*session);
        const FlowerState state = shCapture(*session, FlowerState::How::Walk);
        despawnPlayer(*session, false);
        shReturnLease(*session, &state);
    }
    // A rift opened here leads to a disc that was only ever this server's.
    if (waves_.phase != WavePhase::Idle && leaving(waves_.riftRealm)) closeWaves();
    const std::string drops = shTakeDrops(hosted.realms);
    for (Bot& bot : bots_) {
        if (leaving(bot.realm)) destroyBot(bot);
    }
    bots_.erase(std::remove_if(bots_.begin(), bots_.end(),
                               [&](const Bot& bot) { return leaving(bot.realm); }),
                bots_.end());
    for (const Realm realm : hosted.realms) shClearRealm(realm);
    shHostedChanged();
    commands_.flush();
    savedBossClocks_.erase(std::remove_if(savedBossClocks_.begin(), savedBossClocks_.end(),
                                          [&](const SavedBossClock& c) { return c.biome == biome; }),
                           savedBossClocks_.end());
    shSendRows();
    ByteWriter w = begin(ToGateway::Released);
    w.str(biome);
    w.blob(drops);
    shSend(w);
    std::printf("[cluster] handed %s over\n", biome.c_str());
}

void GameServer::shClearRealm(Realm realm) {
    std::vector<Entity> gone;
    Query<Transform> everything{world_};
    everything.each([&](Entity e, Transform& at) {
        if (at.realm != realm || world_.has<PlayerTag>(e)) return;
        // A petal or a pet goes with its flower, and every flower here has
        // gone through despawnPlayer or destroyBot.
        gone.push_back(e);
    });
    for (const Entity e : gone) commands_.destroy(e);
    spawning_->forgetRealm(realm);
}

std::string GameServer::shTakeDrops(const std::vector<Realm>& realms) {
    Json list = Json::array();
    Query<DropItem, Transform, Lifetime> drops{world_};
    drops.each([&](Entity e, DropItem& item, Transform& at, Lifetime& life) {
        if (std::find(realms.begin(), realms.end(), at.realm) == realms.end()) return;
        Json row = Json::object();
        row["petal"] = Json(content().petal(item.configIndex).id);
        row["rarity"] = Json(static_cast<int>(item.rarity));
        row["realm"] = Json(static_cast<int>(at.realm));
        row["x"] = Json(at.position.x);
        row["y"] = Json(at.position.y);
        row["left"] = Json(life.remainingSeconds);
        row["single"] = Json(item.singleCopy);
        row["humans"] = Json(item.humansOnly);
        row["sacrifice"] = Json(e == sacrificeDrop_);
        // Reserved by connection, which is the same number on every server; a
        // claim with none was a bot's, and no bot crosses.
        const auto owners = [](const std::vector<LootClaim>& claims) {
            Json out = Json::array();
            for (const LootClaim& claim : claims) {
                if (claim.owner != 0) out.push(Json(static_cast<double>(claim.owner)));
            }
            return out;
        };
        row["reserved"] = Json(!item.eligible.empty());
        row["eligible"] = owners(item.eligible);
        row["taken"] = owners(item.pickedUpBy);
        list.push(std::move(row));
    });
    return list.size() > 0 ? list.dump(0) : std::string();
}

void GameServer::shPlaceDrops(const std::string& text) {
    if (text.empty()) return;
    const Json list = Json::parseOrNull(text);
    for (const Json& row : list.items()) {
        const std::uint16_t petal = content().petalIndex(row["petal"].asString());
        if (petal == kInvalidIndex) continue;
        const auto claims = [](const Json& owners) {
            std::vector<LootClaim> out;
            for (const Json& owner : owners.items()) {
                out.emplace_back(NULL_ENTITY, static_cast<net::ConnectionId>(owner.asDouble()));
            }
            return out;
        };
        std::vector<LootClaim> eligible = claims(row["eligible"]);
        // Reserved for nobody who can come for it: not a free-for-all.
        if (row["reserved"].asBool() && eligible.empty()) continue;
        const Realm realm = realmFromByte(static_cast<std::uint8_t>(row["realm"].asInt()));
        const Entity drop = loot_->spawnDrop(
            world_, petal, static_cast<Rarity>(row["rarity"].asInt()),
            Vec2{row["x"].asDouble(), row["y"].asDouble()}, realm, {});
        if (drop == NULL_ENTITY) continue;
        DropItem& item = world_.get<DropItem>(drop);
        item.eligible = std::move(eligible);
        item.singleCopy = row["single"].asBool();
        item.humansOnly = row["humans"].asBool();
        item.pickedUpBy = claims(row["taken"]);
        world_.get<Lifetime>(drop).remainingSeconds = row["left"].asDouble();
        if (row["sacrifice"].asBool()) sacrificeDrop_ = drop;
    }
}

void GameServer::restoreBossClock(const std::string& biome, double nowMillis) {
    const Json& entry = database_.storedTable("bossClocks")[biome];
    if (!entry.isObject() || !entry["uniqueReadyAt"].isNumber() || !entry["apexReadyAt"].isNumber()) {
        return;
    }
    const double offset = nowMillis - static_cast<double>(database_.nowMillis());
    const double unique = std::min(entry["uniqueReadyAt"].asDouble() + offset,
                                   nowMillis + kUniqueSpawnCooldownMillis);
    const double apex =
        std::min(entry["apexReadyAt"].asDouble() + offset, nowMillis + kApexSpawnCooldownMaxMillis);
    const double due = entry["apexDueAt"].isNumber()
                           ? std::max(1.0, std::min(entry["apexDueAt"].asDouble() + offset,
                                                    nowMillis + kApexOverdueMaxMillis))
                           : 0.0;
    spawning_->restoreBossClock(biome, unique, apex, due);
    savedBossClocks_.erase(std::remove_if(savedBossClocks_.begin(), savedBossClocks_.end(),
                                          [&](const SavedBossClock& c) { return c.biome == biome; }),
                           savedBossClocks_.end());
    savedBossClocks_.push_back(SavedBossClock{biome, unique, apex, due});
}

// ---------------------------------------------------------------------------
// Clients at this server's own port
// ---------------------------------------------------------------------------
//
// The gateway signs a client in and, when its flower comes here, sends its
// socket here with a ticket (ToServer::Expect, ServerMessage::Redirect). The
// socket says Hello and Attach; from then on it is the session the gateway
// numbered, and nothing between the two passes through anyone else.

void GameServer::shDoorOpened(net::Connection& socket) {
    // Servers link to the gateway, never to one of its servers.
    if (!shard_->welcomed || socket.path() == net::ws::kLinkPath) {
        // Nobody signed in can have been sent here yet: it goes back to the
        // gateway.
        socket.closeGracefully();
        return;
    }
    shard_->door->sockets[socket.id()] = Shard::Door::Socket{};
}

void GameServer::shDoorFrame(net::Connection& socket, ByteReader& reader) {
    Shard& s = *shard_;
    const auto at = s.door->sockets.find(socket.id());
    if (at == s.door->sockets.end() || socket.closing()) return;
    if (at->second.client != 0) {
        shClientFrame(at->second.client, reader);
        return;
    }
    const auto kind = static_cast<net::ClientMessage>(reader.u8());
    if (!at->second.greeted) {
        // The same handshake as anywhere: this build, this content.
        if (kind != net::ClientMessage::Hello) {
            socket.closeGracefully();
            return;
        }
        const std::uint16_t version = reader.u16();
        const std::uint32_t contentHash = reader.u32();
        const bool attaching = reader.ok() && reader.remaining() > 0 && reader.boolean();
        ByteWriter w;
        const bool ok = reader.ok() && writeWelcome(w, version, contentHash);
        socket.send(w);
        if (!ok) {
            socket.closeGracefully();
            return;
        }
        at->second.greeted = true;
        if (!attaching) {
            // Not sent here: signing in is the gateway's, and it is there --
            // a page served from this port, or a bookmark from before this
            // server was linked. Nothing it says is passed on. Through the
            // proxy to the gateway's proxied hostname; straight to its port
            // only from straight here.
            const bool viaProxy = cameThroughProxy(socket.peer(), socket.forwarded());
            if (s.gatewayPublicHost.empty() && viaProxy) {
                sendNotice(socket, net::NoticeSeverity::Bad,
                           "This server is part of a larger game, and the game's address is not set up yet.");
            } else {
                ByteWriter there;
                there.u8(static_cast<std::uint8_t>(net::ServerMessage::Redirect));
                there.str(s.gatewayPublicHost.empty() ? s.gatewayDirectHost : s.gatewayPublicHost);
                there.u16(s.gatewayPublicHost.empty() ? s.gatewayDirectPort : s.gatewayPublicPort);
                there.str("");
                socket.send(there);
            }
            socket.closeGracefully();
        }
        return;
    }
    if (kind != net::ClientMessage::Attach) {
        socket.closeGracefully();
        return;
    }
    const std::string ticket = reader.str();
    if (!reader.ok()) {
        socket.closeGracefully();
        return;
    }
    shAttach(socket, ticket);
}

void GameServer::shAttach(net::Connection& socket, const std::string& ticket) {
    Shard& s = *shard_;
    const auto found = s.expected.find(ticket);
    Session* session = nullptr;
    if (found != s.expected.end()) {
        if (found->second.expiresMillis >= monotonicMillis()) session = sessionFor(found->second.client);
        s.expected.erase(found);
    }
    ByteWriter w;
    w.u8(static_cast<std::uint8_t>(net::ServerMessage::Attached));
    if (session == nullptr || !session->expected || session->door != 0) {
        // It goes back to the gateway, which signs it in again.
        w.boolean(false);
        socket.send(w);
        socket.closeGracefully();
        return;
    }
    const net::ConnectionId id = session->connection;
    s.door->sockets[socket.id()].client = id;
    session->door = socket.id();
    session->expected = false;
    w.boolean(true);
    socket.send(w);
    // What was said to it on its way, already behind the lease journal.
    bool sentOn = false;
    for (const std::vector<std::byte>& frame : session->transit) {
        socket.send(frame.data(), frame.size());
        // Sent on again before it got here: nothing after that is this socket's.
        if (!frame.empty() && static_cast<net::ServerMessage>(frame[0]) == net::ServerMessage::Redirect) {
            sentOn = true;
            break;
        }
    }
    session->transit.clear();
    session->transitBytes = 0;
    if (sentOn) {
        shCloseDoor(*session);
        return;
    }
    ByteWriter told = begin(ToGateway::Attached);
    told.u32(id);
    shSend(told);
}

void GameServer::shDoorClosed(net::Connection& socket) {
    Shard& s = *shard_;
    const auto at = s.door->sockets.find(socket.id());
    if (at == s.door->sockets.end()) return;
    const net::ConnectionId id = at->second.client;
    s.door->sockets.erase(at);
    Session* session = id != 0 ? sessionFor(id) : nullptr;
    if (session == nullptr || session->door != socket.id()) return;
    session->door = 0;
    // The client is gone: the gateway ends the session, and says so here.
    ByteWriter w = begin(ToGateway::ClientClose);
    w.u32(id);
    shSend(w);
}

void GameServer::shCloseDoor(Session& session) {
    if (session.door == 0 || !shard_->door) return;
    if (net::Connection* socket = shard_->door->listener.find(session.door)) socket->closeGracefully();
    shard_->door->sockets.erase(session.door);
    session.door = 0;
}

void GameServer::shClientFrame(net::ConnectionId id, ByteReader& reader) {
    Session* session = sessionFor(id);
    net::Connection* client = listener_.find(id);
    if (session == nullptr || client == nullptr || client->closing() || reader.remaining() == 0) return;
    const auto kind = static_cast<net::ClientMessage>(reader.rest()[0]);
    if (kind == net::ClientMessage::Hello || kind == net::ClientMessage::Attach) {
        // A second handshake on a live socket, as handleHello refuses one.
        client->closeGracefully();
        return;
    }
    const auto hold = [&] {
        if (session->heldForGateway.size() >= 256) {
            client->closeGracefully();
            return;
        }
        session->heldForGateway.emplace_back(reader.rest(), reader.rest() + reader.remaining());
    };
    // What the flower does is this server's; so is leaving the world with it.
    const bool here = session->lease != 0 &&
                      (cluster::whereHandled(kind) == cluster::Where::There ||
                       kind == net::ClientMessage::LeaveGame);
    if (here) {
        // Behind a purchase whose answer it may need -- but a flower still
        // steers while it shops.
        if (session->awaitingGateway && kind != net::ClientMessage::Input &&
            kind != net::ClientMessage::Ping) {
            hold();
            return;
        }
        onMessage(*client, reader);
        return;
    }
    // The gateway's to answer. Everything sent before it has been carried
    // out here; the rows it may be about go ahead of it on the link.
    const bool awaits = cluster::awaitsGateway(kind) && session->lease != 0;
    if (awaits && session->awaitingGateway) {
        hold();
        return;
    }
    const bool atMarket = awaits && shAtMarket(*session);
    shSendRows();
    ByteWriter w(reader.remaining() + 8);
    w.u8(static_cast<std::uint8_t>(ToGateway::FromClient));
    w.u32(id);
    w.boolean(atMarket);
    w.raw(reader.rest(), reader.remaining());
    shSend(w);
    if (awaits) session->awaitingGateway = true;
}

void GameServer::shDeliver(net::ConnectionId id, const std::byte* data, std::size_t size) {
    Session* session = sessionFor(id);
    if (session == nullptr || size == 0) return;
    const auto kind = static_cast<net::ServerMessage>(data[0]);
    if ((session->door != 0 || session->expected) &&
        (kind == net::ServerMessage::SquadUpdate || kind == net::ServerMessage::SquadInviteReceived)) {
        // The gateway does not see this frame, and its squad commands go to
        // wherever the squad is.
        ByteWriter note = begin(ToGateway::SquadNote);
        note.u32(id);
        note.u8(static_cast<std::uint8_t>(kind));
        note.u8(size > 1 ? static_cast<std::uint8_t>(data[1]) : 0);
        shSend(note);
    }
    if (session->door != 0) {
        net::Connection* socket = shard_->door ? shard_->door->listener.find(session->door) : nullptr;
        if (socket == nullptr) return;
        socket->send(data, size);
        if (static_cast<net::ServerMessage>(data[0]) == net::ServerMessage::Redirect) {
            // Sent on elsewhere: this was the last of this socket.
            shCloseDoor(*session);
        }
        return;
    }
    if (session->expected) {
        // On its way here: kept for it.
        if (session->transitBytes + size > cluster::kMaxTransitBytes) {
            session->transit.clear();
            session->transitBytes = 0;
            session->expected = false;
            return;
        }
        session->transit.emplace_back(data, data + size);
        session->transitBytes += size;
        return;
    }
    // A client whose socket is elsewhere -- in a squad here, or answered by an
    // admin command run here: the gateway knows where.
    ByteWriter w(size + 8);
    w.u8(static_cast<std::uint8_t>(ToGateway::ClientFrame));
    w.u32(id);
    w.raw(data, size);
    shSend(w);
}

bool GameServer::shAtMarket(Session& session) {
    // Banked first: what the body earned is in the row the gateway spends.
    if (session.playing()) persistPlayer(session);
    const bool standing = session.playing() && world_.isAlive(session.entity) && !world_.has<Dead>(session.entity);
    const Transform* at = standing ? world_.tryGet<Transform>(session.entity) : nullptr;
    if (at == nullptr) return false;
    if (npcs_->findService(world_, NpcService::Market, at->position, at->realm,
                           kNpcServiceReach + kNpcServiceSlack) != NULL_ENTITY) {
        session.marketAccess = true;
    }
    return session.marketAccess && session.controlling == 0 && session.controlledBy == 0 &&
           !session.arena && !session.eventKit;
}

void GameServer::shRecover(std::uint64_t taken) {
    Shard& s = *shard_;
    // Whatever the gateway has is not to be numbered again.
    s.journal.startFrom(taken);
    s.journal.taken(taken);
    const std::vector<cluster::LeaseJournal::Recovery> rows = s.journal.unacknowledged(taken);
    // Every lease the journal knows of ended with the link: what is handed
    // over now is all of them will ever hand over.
    s.journal.closeAll();
    if (rows.empty()) return;
    std::printf("[cluster] handing the gateway %zu row%s it never took\n", rows.size(),
                rows.size() == 1 ? "" : "s");
    ByteWriter w = begin(ToGateway::Recovered);
    w.u64(s.journal.lastSeq());
    w.u16(static_cast<std::uint16_t>(std::min<std::size_t>(rows.size(), 0xFFFF)));
    for (std::size_t i = 0; i < rows.size() && i < 0xFFFF; ++i) {
        w.str(rows[i].user);
        w.blob(rows[i].base);
        w.blob(rows[i].row);
    }
    shSend(w);
}

void GameServer::shLeave() {
    if (config_.membership.role != cluster::Membership::Role::Shard) {
        std::fprintf(stderr, "[cluster] asked to leave, but --role shard says to stay\n");
        return;
    }
    cluster::Membership m = config_.membership;
    m.role = cluster::Membership::Role::Alone;
    std::string error;
    if (!relink(std::move(m), error)) std::fprintf(stderr, "[cluster] could not leave: %s\n", error.c_str());
}

// ---------------------------------------------------------------------------
// Squads
// ---------------------------------------------------------------------------
//
// A squad works one biome, and a biome is one server's, so a squad lives on
// the server its biome is on and the code that keeps it is the single
// server's. What is left over is a squad whose only body walks to another
// server: it goes along.

void GameServer::shSquadLeaving(net::ConnectionId id, const std::string& toBiome) {
    Session* session = sessionFor(id);
    if (session == nullptr) return;
    const SquadMemberId me = squadIdOf(*session);
    Squad* squad = squads_.forMember(me);
    if (squad == nullptr) return;
    std::string here;
    for (const SquadMemberId& member : squad->members) {
        if (member == me) continue;
        const std::string biome = biomeOfEntity(squadEntityOf(member));
        if (!biome.empty()) here = biome;
    }
    net::Connection* connection = listener_.find(id);
    if (!here.empty() && here != toBiome) {
        departSquad(*session, connection, squadDisplayName(me));
        if (connection != nullptr) {
            sendNotice(*connection, net::NoticeSeverity::Warning,
                       "You left your squad by leaving " + biomeLabel(here) +
                           ". A squad cannot span biomes.");
        }
        return;
    }
    cluster::SquadState moved;
    moved.id = squad->id;
    moved.isPublic = squad->isPublic;
    moved.leader = squad->leader.connection;
    for (const SquadMemberId& member : squad->members) {
        if (!member.bot()) moved.members.push_back(member.connection);
    }
    squads_.disband(moved.id);
    listener_.flush();
    ByteWriter w = begin(ToGateway::SquadMoved);
    w.u32(id);
    moved.write(w);
    shSend(w);
}

void GameServer::shSquadArrived(const cluster::SquadState& state) {
    Squad squad;
    squad.id = state.id;
    squad.isPublic = state.isPublic;
    for (const net::ConnectionId member : state.members) {
        const SquadMemberId who = SquadMemberId::ofSession(member);
        if (sessionFor(member) == nullptr || squads_.forMember(who) != nullptr) continue;
        squad.members.push_back(who);
        if (member == state.leader) squad.leader = who;
    }
    if (squad.members.empty()) return;
    if (!squad.leader.valid()) squad.leader = squad.members.front();
    if (const Squad* placed = squads_.adopt(std::move(squad))) broadcastSquadUpdate(*placed);
}

// ---------------------------------------------------------------------------
// Once a tick
// ---------------------------------------------------------------------------

void GameServer::shTick(double) {
    Shard& s = *shard_;
    const double now = monotonicMillis();
    shServiceCopy(now);
    for (auto it = s.expected.begin(); it != s.expected.end();) {
        it = it->second.expiresMillis < now ? s.expected.erase(it) : std::next(it);
    }
    if (!s.welcomed) return;
    for (auto& entry : sessions_) {
        Session& session = entry.second;
        if (session.lease == 0 || !session.playing()) continue;
        cluster::ClientState state;
        state.playing = true;
        state.dead = world_.has<Dead>(session.entity);
        state.split = session.split();
        state.arena = session.arena != nullptr;
        state.eventKit = session.eventKit != nullptr;
        state.controlled = session.controlling != 0 || session.controlledBy != 0;
        state.realm = session.realm;
        if (const NetId* id = world_.tryGet<NetId>(session.entity)) state.netId = id->value;
        if (const PlayerProgress* live = world_.tryGet<PlayerProgress>(session.entity)) {
            state.level = live->level;
        }
        ByteWriter told;
        state.write(told);
        // The waits are durations, different every tick: told when something
        // else is, and compared without them.
        if (told.buffer() == session.toldState) continue;
        session.toldState = told.buffer();
        state.oracleWait = oracleWaitMillis(session.userId);
        state.traderWait = traderWaitMillis(session.userId);
        ByteWriter w = begin(ToGateway::ClientState);
        w.u32(session.connection);
        state.write(w);
        shSend(w);
    }
    if (now >= s.nextHeartbeatMillis) {
        s.nextHeartbeatMillis = now + cluster::kLinkHeartbeatMillis;
        shSend(begin(ToGateway::Heartbeat));
    }
    if (now < s.nextStatsMillis) return;
    s.nextStatsMillis = now + kStatsIntervalMillis;
    cluster::ServerStats stats;
    stats.tickMillis = s.tickMillis;
    std::array<cluster::ServerStats::RealmLoad, kMaxRealms> loads{};
    Query<PlayerTag, Transform> flowers{world_};
    flowers.each([&](Entity e, PlayerTag&, Transform& at) {
        if (!world_.has<Dead>(e)) ++loads[realmIndex(at.realm)].flowers;
    });
    for (const auto& entry : sessions_) {
        if (entry.second.playing()) ++loads[realmIndex(entry.second.realm)].humans;
    }
    Query<MobTag, Transform, MobType> mobs{world_};
    mobs.each([&](Entity e, MobTag&, Transform& at, MobType& type) {
        cluster::ServerStats::RealmLoad& load = loads[realmIndex(at.realm)];
        ++load.mobs;
        if (rarityIndex(type.rarity) >= rarityIndex(Rarity::Unique) && !world_.has<Pet>(e)) {
            load.boss = true;
        }
    });
    for (int i = 0; i < kMaxRealms; ++i) {
        cluster::ServerStats::RealmLoad& load = loads[static_cast<std::size_t>(i)];
        if (load.flowers == 0 && load.mobs == 0) continue;
        load.realm = static_cast<Realm>(i);
        stats.realms.push_back(load);
    }
    for (const SpawnSystem::BiomeBossClock& clock : spawning_->bossClocks()) {
        if (!clock.scattered) continue;
        const bool ours = std::any_of(s.hosted.begin(), s.hosted.end(),
                                      [&](const Shard::Hosted& h) { return h.biome == clock.biome; });
        if (!ours) continue;
        stats.clocks.push_back({clock.biome, clock.uniqueReadyMillis - clockMillis_,
                                clock.apexReadyMillis - clockMillis_});
    }
    ByteWriter w = begin(ToGateway::Stats);
    stats.write(w);
    shSend(w);
}

void GameServer::announceByPlace(const std::string& here, const std::string& elsewhere,
                                 const std::function<bool(const Session&)>& isHere) {
    if (shard_) {
        shSendRows();
        ByteWriter w = begin(ToGateway::Announce);
        w.str(here);
        w.str(elsewhere);
        std::vector<net::ConnectionId> present;
        for (const auto& entry : sessions_) {
            if (entry.second.lease != 0 && isHere(entry.second)) present.push_back(entry.first);
        }
        w.u16(static_cast<std::uint16_t>(present.size()));
        for (const net::ConnectionId id : present) w.u32(id);
        shSend(w);
        return;
    }
    for (auto& entry : sessions_) {
        if (!entry.second.authenticated()) continue;
        net::Connection* connection = listener_.find(entry.first);
        if (connection == nullptr) continue;
        sendChatTo(*connection, net::ChatChannel::System, "",
                   isHere(entry.second) ? here : elsewhere);
    }
}

} // namespace flix
