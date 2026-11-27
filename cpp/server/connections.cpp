// The connection layer: sessions coming and going, the handshake, and the one
// switch that bills every client message and hands it to its handler.

#include "server/game_server.h"

#include <algorithm>
#include <cmath>
#include <cstdio>
#include <vector>

#include "server/cluster/linking.h"
#include "server/loot_eligibility.h"
#include "server/routine_log_policy.h"
#include "server/text.h"
#include "shared/game/config.h"
#include "shared/net/websocket.h"

namespace flix {

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

Session* GameServer::creditedSession(Entity body) {
    if (Session* session = sessionForEntity(body)) return session;
    if (body == NULL_ENTITY) return nullptr;
    for (auto& entry : sessions_) {
        Session& session = entry.second;
        // The account the body played for, still signed in on this socket.
        if (session.lastBody == body && !session.userId.empty() &&
            session.lastBodyUserId == session.userId) {
            return &session;
        }
    }
    return nullptr;
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

void GameServer::onConnect(net::Connection& connection) {
    // Another server, at this port for the link between them: only a server
    // on its own, with a key, waiting to be joined, has anything to say to
    // one (a gateway's port takes them in gwDoorOpened). Not a session.
    if (connection.path() == net::ws::kLinkPath) {
        if (!gateway_ && !shard_) doorTakes(connection);
        else connection.closeGracefully();
        return;
    }
    // A gateway checking a domain that leads here, to a server that is none of
    // its: nothing to answer.
    if (connection.path() == net::ws::kReachPath) {
        connection.closeGracefully();
        return;
    }
    Session session;
    session.connection = connection.id();
    session.connectedAtMillis = monotonicMillis();
    session.clientAddress = clientAddress(connection.peer(), connection.forwarded());
    sessions_[connection.id()] = std::move(session);
    views_[connection.id()] = ClientView{};
}

void GameServer::onDisconnect(net::Connection& connection, const std::string&) {
    if (door_ && door_->diallers.erase(connection.id()) != 0) return;
    // This server is done with the client: so is its socket, wherever it is.
    if (shard_) shClientClosed(connection.id());
    if (gateway_) gwClientClosed(connection.id());
    endSession(connection.id());
}

void GameServer::endSession(net::ConnectionId id) {
    if (Session* session = sessionFor(id)) {
        // Before the body is destroyed, so the line the squad is told still
        // knows what this flower was called.
        departSquad(*session, nullptr, squadDisplayName(squadIdOf(*session)));
        // The session is erased below: its body goes first.
        dropBody(*session);
        if (shard_ && session->lease != 0) shReturnLease(*session, nullptr);
        if (gateway_) gwRelease(*session);
    }
    revokeTempAdmin(id);
    sessions_.erase(id);
    views_.erase(id);
}

void GameServer::reapSessionsWithoutSockets() {
    // Collected first: endSession erases from sessions_, and it tells the
    // squad, which reads other sessions, so nothing may be ended mid-walk.
    std::vector<net::ConnectionId> orphaned;
    for (const auto& entry : sessions_) {
        if (listener_.find(entry.first) == nullptr) orphaned.push_back(entry.first);
    }
    for (const net::ConnectionId id : orphaned) {
        const Session& session = sessions_.at(id);
        if (shouldLogRoutineActivity(session.username)) {
            std::printf("[SESSION] connection %u closed without a disconnect; ending its session (%s%s)\n",
                        static_cast<unsigned>(id),
                        session.username.empty() ? "not signed in" : session.username.c_str(),
                        session.entity != NULL_ENTITY ? ", in the world" : "");
        }
        std::fflush(stdout);
        endSession(id);
    }
}

void GameServer::reapUngreeted() {
    // Generous: the shipping client's Hello is its first frame, sent from the
    // transport's own connect callback, so only a socket that means to say
    // nothing is still here after this.
    constexpr double kGreetingMillis = 15000.0;
    const double now = monotonicMillis();
    for (const auto& [id, session] : sessions_) {
        if (session.stage != SessionStage::Greeting) continue;
        if (now - session.connectedAtMillis < kGreetingMillis) continue;
        if (net::Connection* connection = listener_.find(id)) connection->closeGracefully();
    }
}

void GameServer::onMessage(net::Connection& connection, ByteReader& reader) {
    // A server dialling to join this one: not a session.
    if (door_ && door_->diallers.count(connection.id()) != 0) {
        doorMessage(connection, reader);
        return;
    }
    Session* session = sessionFor(connection.id());
    if (!session) return;

    const auto id = static_cast<net::ClientMessage>(reader.u8());


    // Nothing but the handshake is accepted until the protocol has been agreed.
    // A client that skips it cannot reach any game logic at all.
    if (session->stage == SessionStage::Greeting && id != net::ClientMessage::Hello) {
        connection.closeGracefully();
        return;
    }

    // In a sharded game most of what a playing client asks for is asked of the
    // server its flower is on, whose bill it is.
    if (gateway_ && gwRoute(*session, connection, id, reader)) return;

    // Bill before dispatch, including invalid requests. These handlers can
    // reapply a whole ring, scan the bag and send a full Profile; without a
    // shared ceiling a modified client can do that once per packet, and
    // alternate message types to evade a per-handler limit. Excess requests
    // have no side effects and produce no reply to amplify the flood.
    switch (id) {
        case net::ClientMessage::AdminTools:
        case net::ClientMessage::SetLoadout:
        case net::ClientMessage::SwapLoadout:
        case net::ClientMessage::SwapLoadoutRows:
        case net::ClientMessage::SaveLoadoutPreset:
        case net::ClientMessage::LoadLoadoutPreset:
        case net::ClientMessage::Craft:
        case net::ClientMessage::OracleCraft:
        case net::ClientMessage::Trade:
        case net::ClientMessage::TitanForge:
        case net::ClientMessage::Assemble:
        case net::ClientMessage::Absorb:
        case net::ClientMessage::BuyPetal:
        case net::ClientMessage::ClaimTrialReward:
        case net::ClientMessage::UpgradeSkill:
        case net::ClientMessage::ResetSkills:
        case net::ClientMessage::RedeemCode:
            if (!session->authenticated() || !spend(session->inventoryAllowance)) return;
            break;
        // The same rule for everything else that is dear to answer. Not
        // gated on sign-in here: the leaderboard and the feed are read from
        // the title screen, and each handler below checks its own standing.
        case net::ClientMessage::JoinGame:
        case net::ClientMessage::LeaveGame:
        case net::ClientMessage::Respawn:
        case net::ClientMessage::EquipSkin:
        case net::ClientMessage::DeleteSkin:
        case net::ClientMessage::VoteSkin:
        case net::ClientMessage::FavoriteSkin:
        case net::ClientMessage::RequestLeaderboard:
        case net::ClientMessage::RequestNotifications:
        case net::ClientMessage::GuildCreate:
        case net::ClientMessage::GuildEdit:
        case net::ClientMessage::GuildInvite:
        case net::ClientMessage::GuildAccept:
        case net::ClientMessage::GuildDecline:
        case net::ClientMessage::GuildKick:
        case net::ClientMessage::GuildLeave:
        case net::ClientMessage::GuildSquadAll:
        case net::ClientMessage::GuildInviteToSquad:
        case net::ClientMessage::StartTrialChamber:
        case net::ClientMessage::GuildSetOfficer:
            if (!spend(session->requestAllowance)) return;
            break;
        // PublishSkin and EditSkin are billed too, but by their handler, which
        // says so: a player retrying a refused design should hear why nothing
        // happened. So are BrowseSkins and FetchSkins, whose handlers answer a
        // refusal so that the client knows to ask again.
        default: break;
    }

    if (session->eventKit || session->elsewhere.state.eventKit) {
        switch(id) {
            case net::ClientMessage::Craft: case net::ClientMessage::OracleCraft:
            case net::ClientMessage::Trade: case net::ClientMessage::TitanForge:
            case net::ClientMessage::Assemble: case net::ClientMessage::Absorb:
            case net::ClientMessage::BuyPetal: case net::ClientMessage::ClaimTrialReward:
                sendNotice(connection,net::NoticeSeverity::Warning,"Economy changes are disabled during hosted events.");return;
            default:break;
        }
    }

    switch (id) {
        case net::ClientMessage::Hello:         handleHello(*session, connection, reader); break;
        case net::ClientMessage::Register:      handleRegister(*session, connection, reader); break;
        case net::ClientMessage::RegisterGuest: handleRegisterGuest(*session, connection); break;
        case net::ClientMessage::SetUsername:   handleSetUsername(*session, connection, reader); break;
        case net::ClientMessage::Login:         handleLogin(*session, connection, reader); break;
        case net::ClientMessage::ResumeSession: handleResume(*session, connection, reader); break;
        case net::ClientMessage::ChangePassword:
            handleChangePassword(*session, connection, reader);
            break;
        case net::ClientMessage::JoinGame:      handleJoin(*session, connection, reader); break;
        case net::ClientMessage::LeaveGame:     handleLeave(*session, connection); break;
        case net::ClientMessage::Input:         handleInput(*session, reader); break;
        case net::ClientMessage::Chat:          handleChat(*session, connection, reader); break;
        case net::ClientMessage::SetLoadout:    handleSetLoadout(*session, connection, reader); break;
        case net::ClientMessage::ProfileCheck:  handleProfileCheck(*session, connection, reader); break;
        case net::ClientMessage::SwapLoadout:   handleSwapLoadout(*session, connection, reader); break;
        case net::ClientMessage::SwapLoadoutRows: handleSwapLoadoutRows(*session, connection); break;
        case net::ClientMessage::SaveLoadoutPreset:
            handleSaveLoadoutPreset(*session, connection, reader);
            break;
        case net::ClientMessage::LoadLoadoutPreset:
            handleLoadLoadoutPreset(*session, connection, reader);
            break;
        case net::ClientMessage::UsePetal:      handleUsePetal(*session, reader); break;
        case net::ClientMessage::Craft:         handleCraft(*session, connection, reader); break;
        case net::ClientMessage::OracleCraft:   handleOracleCraft(*session, connection, reader); break;
        case net::ClientMessage::Trade:         handleTrade(*session, connection, reader); break;
        case net::ClientMessage::TitanForge:    handleTitanForge(*session, connection, reader); break;
        case net::ClientMessage::Assemble:      handleAssemble(*session, connection, reader); break;
        case net::ClientMessage::Absorb:        handleAbsorb(*session, connection, reader); break;
        case net::ClientMessage::TitanHolder:   handleTitanHolder(*session, connection, reader); break;
        case net::ClientMessage::Respawn:       handleRespawn(*session); break;
        case net::ClientMessage::Ping:          handlePing(connection, reader); break;
        case net::ClientMessage::UpgradeSkill:  handleUpgradeSkill(*session, connection, reader); break;
        case net::ClientMessage::ResetSkills:   handleResetSkills(*session, connection); break;
        case net::ClientMessage::BuyPetal:      handleBuyPetal(*session, connection, reader); break;
        case net::ClientMessage::RedeemCode:    handleRedeemCode(*session, connection, reader); break;
        case net::ClientMessage::RequestLeaderboard:
            handleLeaderboard(*session, connection, reader);
            break;
        case net::ClientMessage::RequestNotifications: handleNotifications(connection, reader); break;
        case net::ClientMessage::SetMobDamageBoard: {
            const std::uint8_t bits = reader.u8();
            if (reader.ok()) {
                session->boardWanted = (bits & 1) != 0;
                session->boardSuper = (bits & 2) != 0;
            }
            break;
        }
        case net::ClientMessage::GuildCreate:   handleGuildCreate(*session, connection, reader); break;
        case net::ClientMessage::GuildEdit:     handleGuildEdit(*session, connection, reader); break;
        case net::ClientMessage::GuildInvite:   handleGuildInvite(*session, connection, reader); break;
        case net::ClientMessage::GuildAccept:   handleGuildAccept(*session, connection); break;
        case net::ClientMessage::GuildDecline:  handleGuildDecline(*session, connection); break;
        case net::ClientMessage::GuildKick:     handleGuildKick(*session, connection, reader); break;
        case net::ClientMessage::GuildLeave:    handleGuildLeave(*session, connection); break;
        case net::ClientMessage::GuildSquadAll: handleGuildSquadAll(*session, connection); break;
        case net::ClientMessage::GuildInviteToSquad:
            handleGuildInviteToSquad(*session, connection, reader);
            break;
        case net::ClientMessage::GuildSetOfficer:
            handleGuildSetOfficer(*session, connection, reader);
            break;
        case net::ClientMessage::AdminTools: handleAdminTools(*session, connection, reader); break;
        case net::ClientMessage::PublishSkin:   handlePublishSkin(*session, connection, reader); break;
        case net::ClientMessage::EditSkin:      handleEditSkin(*session, connection, reader); break;
        case net::ClientMessage::EquipSkin:     handleEquipSkin(*session, connection, reader); break;
        case net::ClientMessage::DeleteSkin:    handleDeleteSkin(*session, connection, reader); break;
        case net::ClientMessage::VoteSkin:      handleVoteSkin(*session, connection, reader); break;
        case net::ClientMessage::FavoriteSkin:  handleFavoriteSkin(*session, connection, reader); break;
        case net::ClientMessage::BrowseSkins:   handleBrowseSkins(*session, connection, reader); break;
        case net::ClientMessage::FetchSkins:    handleFetchSkins(*session, connection, reader); break;
        case net::ClientMessage::ClaimTrialReward:
            handleClaimTrialReward(*session, connection, reader);
            break;
        case net::ClientMessage::StartTrialChamber:
            handleStartTrialChamber(*session);
            break;
        case net::ClientMessage::Logout:        handleLogout(*session); break;
        case net::ClientMessage::AdminDb:       handleAdminDb(*session, connection, reader); break;
        case net::ClientMessage::AdminDashboard:
            handleAdminDashboard(*session, connection, reader);
            break;
        default:
            break;
    }
}

void GameServer::handleHello(Session& session, net::Connection& connection, ByteReader& reader) {
    // Once per socket. The shipping client sends its Hello from
    // NetClient::onConnect, which the transport calls once per dial, so a
    // second one on a live socket is a modified client -- and it used to be
    // honoured. The stage went back to Anonymous with the body, the account
    // and any temporary grant all still on the session, and everything that
    // looks after a body asks playing(): the periodic save, the disconnect,
    // leaveWorld and the next join. So the flower stood in the world for
    // nobody, unsaved and walking its last input, a steered one included, and
    // every (Hello, Resume, Join) left another -- without limit, for one free
    // account, until a restart. A repeat is closed instead, and the stage it
    // arrived at is left alone: the close then runs through onDisconnect like
    // any other, which saves the body and takes it out. Were a re-handshake
    // ever wanted, it would have to be a signOut(), never a bare stage write.
    if (session.stage != SessionStage::Greeting) {
        connection.closeGracefully();
        return;
    }

    const std::uint16_t version = reader.u16();
    const std::uint32_t clientContent = reader.u32();
    if (!reader.ok()) { connection.closeGracefully(); return; }

    ByteWriter w;
    const bool ok = writeWelcome(w, version, clientContent);
    connection.send(w);
    if (!ok) {
        connection.closeGracefully();
        return;
    }
    session.stage = SessionStage::Anonymous;
}

bool GameServer::writeWelcome(ByteWriter& w, std::uint16_t version, std::uint32_t clientContent) const {
    w.u8(static_cast<std::uint8_t>(net::ServerMessage::Welcome));
    w.u16(net::kProtocolVersion);
    if (version != net::kProtocolVersion) {
        w.boolean(false);
        w.str("This client speaks protocol " + std::to_string(version) + "; the server speaks " +
              std::to_string(net::kProtocolVersion) + ". Please update.");
        return false;
    }
    if (clientContent != content().contentHash()) {
        // Mob and petal stats are read from JSON by both sides. If the two read
        // different files, every number the client shows is quietly wrong --
        // far better to say so at connect time.
        w.boolean(false);
        w.str("Your game content does not match the server's. Please update.");
        return false;
    }
    w.boolean(true);
    w.str("");
    return true;
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

void GameServer::sendNotice(net::Connection& connection, net::NoticeSeverity severity,
                            const std::string& text) {
    ByteWriter w;
    w.u8(static_cast<std::uint8_t>(net::ServerMessage::Notice));
    w.u8(static_cast<std::uint8_t>(severity));
    w.str(text);
    connection.send(w);
}

void GameServer::sendMobDamageBoard(Session& session, net::Connection& connection,
                                    double nowMillis) {
    if (nowMillis < session.boardNextSendMillis) return;
    session.boardNextSendMillis = nowMillis + 250.0;

    const auto clear = [&] {
        if (!session.boardShown) return;
        session.boardShown = false;
        ByteWriter w;
        w.u8(static_cast<std::uint8_t>(net::ServerMessage::MobDamageBoard));
        w.u8(0);
        connection.send(w);
    };
    // Turned off in the client's settings: nothing is built or sent.
    if (!session.boardWanted) {
        clear();
        return;
    }

    // Pick up what combat has recorded since the last look.
    constexpr double kLingerMillis = 120000.0;
    constexpr std::size_t kMaxTracks = 16;
    if (PlayerLocation* location = world_.tryGet<PlayerLocation>(session.entity)) {
        for (const Entity m : location->damagedBoardMobs) {
            const bool known = std::any_of(session.boardTracks.begin(), session.boardTracks.end(),
                                           [&](const Session::BoardTrack& t) { return t.mob == m; });
            if (!known && session.boardTracks.size() < kMaxTracks) {
                session.boardTracks.push_back({m, 0.0, nowMillis});
            }
        }
        location->damagedBoardMobs.clear();
    }

    // The nearest tracked mob wins, however far: the board is not about what is
    // on screen. A mob that is gone, or that this player stopped hitting two
    // minutes ago, is forgotten.
    const Transform* here = world_.tryGet<Transform>(session.entity);
    Entity mob = NULL_ENTITY;
    double bestDistance = 0.0;
    for (auto it = session.boardTracks.begin(); it != session.boardTracks.end();) {
        const Bounty* ledger = world_.tryGet<Bounty>(it->mob);
        const MobType* kind = world_.tryGet<MobType>(it->mob);
        const Health* hp = world_.tryGet<Health>(it->mob);
        const Transform* at = world_.tryGet<Transform>(it->mob);
        bool keep = world_.isAlive(it->mob) && !world_.has<Dead>(it->mob) && ledger != nullptr &&
                    kind != nullptr && hp != nullptr && hp->max > 0.0 && at != nullptr;
        if (keep) {
            double mine = 0.0;
            for (const Bounty::Share& share : ledger->contributors) {
                if (share.damage > 0.0 && session.owns(share.player)) mine += share.damage;
            }
            if (mine > it->own) {
                it->own = mine;
                it->lastHitMillis = nowMillis;
            }
            keep = mine > 0.0 && nowMillis - it->lastHitMillis <= kLingerMillis;
        }
        if (!keep) {
            it = session.boardTracks.erase(it);
            continue;
        }
        // Eternal and Apex always; Super unless the player turned it off.
        const Rarity tier = kind->rarity;
        const bool shownTier = tier == Rarity::Unique || tier == Rarity::Apex ||
                               (tier == Rarity::Super && session.boardSuper);
        if (shownTier && (here == nullptr || at->realm == here->realm)) {
            const double distance = here == nullptr ? 0.0 : distanceSq(at->position, here->position);
            if (mob == NULL_ENTITY || distance < bestDistance) {
                mob = it->mob;
                bestDistance = distance;
            }
        }
        ++it;
    }
    if (mob == NULL_ENTITY) {
        clear();
        return;
    }
    const Bounty* bounty = world_.tryGet<Bounty>(mob);
    const MobType* type = world_.tryGet<MobType>(mob);
    const Health* health = world_.tryGet<Health>(mob);
    const Rarity tier = type->rarity;

    // The ledger, positive damage only, best first. A mob that hit another mob
    // is not a contender; a player who died or left still holds their row, as
    // the loot ledger keeps them.
    std::vector<Bounty::Share> ranked;
    for (const Bounty::Share& share : bounty->contributors) {
        if (share.damage <= 0.0) continue;
        if (world_.isAlive(share.player) && !world_.has<PlayerTag>(share.player)) continue;
        ranked.push_back(share);
    }
    if (ranked.empty()) {
        clear();
        return;
    }
    std::stable_sort(ranked.begin(), ranked.end(),
                     [](const Bounty::Share& a, const Bounty::Share& b) {
                         return a.damage > b.damage;
                     });

    // Who the loot rule would pay RIGHT NOW: the very call the corpse's
    // rewards make, floor, slot cap and squads included.
    std::vector<Entity> recipients;
    selectLootRecipients(ranked, lootSlotsForRarity(tier), &squadIndex_, recipients,
                         lootDamageFloor(health->max));
    const auto groupOf = [&](Entity body) -> long {
        const auto it = squadIndex_.group.find(body);
        return it == squadIndex_.group.end() ? -1 : static_cast<long>(it->second);
    };
    const long myGroup = groupOf(session.entity);

    // One row per PERSON: a splitter's two bodies are one flower on the board.
    struct Row {
        std::string name;
        double damage = 0.0;
        bool self = false;
        bool eligible = false;
        bool squad = false;
        const Session* owner = nullptr;
    };
    std::vector<Row> rows;
    for (const Bounty::Share& share : ranked) {
        const Session* who = creditedSession(share.player);
        Row* row = nullptr;
        if (who != nullptr) {
            for (Row& existing : rows) {
                if (existing.owner == who) { row = &existing; break; }
            }
        }
        if (row == nullptr) {
            rows.emplace_back();
            row = &rows.back();
            row->owner = who;
            row->name = who != nullptr ? who->nameplate() : std::string();
            row->self = who == &session;
        }
        row->damage += share.damage;
        if (std::find(recipients.begin(), recipients.end(), share.player) != recipients.end()) {
            row->eligible = true;
            if (myGroup >= 0 && groupOf(share.player) == myGroup) row->squad = true;
        }
    }
    // Squadmates who have not touched the mob still stand on the board at 0%:
    // the squad is one contender and they are paid with it, so leaving them off
    // would hide who is sharing the loot. Only this player's own squad, and only
    // the members the loot rule counts (a bot that never fought, or a member who
    // left before the fight, is not one).
    if (myGroup >= 0) {
        for (const SquadBody& member : squadIndex_.groups[static_cast<std::size_t>(myGroup)]) {
            if (!member.banks()) continue;
            const Session* who = creditedSession(member.body);
            if (who == nullptr) continue;
            const bool present = std::any_of(rows.begin(), rows.end(),
                                             [&](const Row& r) { return r.owner == who; });
            if (present) continue;
            if (member.away) continue;
            Row row;
            row.name = who->nameplate();
            row.owner = who;
            row.self = who == &session;
            row.eligible = std::find(recipients.begin(), recipients.end(), member.body) !=
                           recipients.end();
            row.squad = true;
            rows.push_back(std::move(row));
        }
    }
    std::stable_sort(rows.begin(), rows.end(),
                     [](const Row& a, const Row& b) { return a.damage > b.damage; });

    // The top ten, and this player's own row if it ranks lower, with its real
    // place.
    constexpr std::size_t kTop = 10;
    std::vector<std::size_t> shown;
    std::size_t selfIndex = rows.size();
    for (std::size_t i = 0; i < rows.size(); ++i) {
        if (rows[i].self) selfIndex = i;
        if (i < kTop) shown.push_back(i);
    }
    if (selfIndex < rows.size() && selfIndex >= kTop) shown.push_back(selfIndex);

    ByteWriter w;
    w.u8(static_cast<std::uint8_t>(net::ServerMessage::MobDamageBoard));
    w.u8(static_cast<std::uint8_t>(shown.size()));
    w.u16(type->configIndex);
    w.u8(static_cast<std::uint8_t>(tier));
    const double age = nowMillis - bounty->spawnedAtMillis;
    w.u32(bounty->spawnedAtMillis > 0.0 && age >= 0.0
              ? static_cast<std::uint32_t>(std::min(age, 4.0e9))
              : 0xFFFFFFFFu);
    for (const std::size_t i : shown) {
        const Row& row = rows[i];
        w.str(row.name);
        w.u16(static_cast<std::uint16_t>(std::min<std::size_t>(i + 1, 0xFFFF)));
        // Out of the MOB'S health, not out of the damage dealt: the ledger
        // counts damage swung, so a bar can reach the end before the mob dies.
        const double share = std::clamp(row.damage / health->max, 0.0, 1.0);
        w.u16(static_cast<std::uint16_t>(std::lround(share * 1000.0)));
        w.u8(static_cast<std::uint8_t>((row.self ? 1 : 0) | (row.eligible ? 2 : 0) |
                                       (row.squad ? 4 : 0)));
    }
    session.boardShown = true;
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

void GameServer::broadcastToAuthenticated(const ByteWriter& message) {
    listener_.each([&](net::Connection& connection) {
        const Session* session = sessionFor(connection.id());
        if (session && hearsHere(*session)) connection.send(message);
    });
}

} // namespace flix
