// The connection layer: sessions coming and going, the handshake, and the one
// switch that bills every client message and hands it to its handler.

#include "server/game_server.h"

#include <cstdio>
#include <vector>

#include "server/routine_log_policy.h"
#include "server/text.h"
#include "shared/game/config.h"

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
    Session session;
    session.connection = connection.id();
    session.connectedAtMillis = monotonicMillis();
    session.clientAddress = clientAddress(connection.peer(), connection.forwarded());
    sessions_[connection.id()] = std::move(session);
    views_[connection.id()] = ClientView{};
}

void GameServer::onDisconnect(net::Connection& connection, const std::string&) {
    endSession(connection.id());
}

void GameServer::endSession(net::ConnectionId id) {
    if (Session* session = sessionFor(id)) {
        // Before the body is destroyed, so the line the squad is told still
        // knows what this flower was called.
        departSquad(*session, nullptr, squadDisplayName(squadIdOf(*session)));
        // The session is erased below: its body goes first.
        dropBody(*session);
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
    Session* session = sessionFor(connection.id());
    if (!session) return;

    const auto id = static_cast<net::ClientMessage>(reader.u8());

    // Nothing but the handshake is accepted until the protocol has been agreed.
    // A client that skips it cannot reach any game logic at all.
    if (session->stage == SessionStage::Greeting && id != net::ClientMessage::Hello) {
        connection.closeGracefully();
        return;
    }

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
            if (!spend(session->requestAllowance)) return;
            break;
        // PublishSkin and EditSkin are billed too, but by their handler, which
        // says so: a player retrying a refused design should hear why nothing
        // happened.
        default: break;
    }

    if (session->eventKit) {
        switch(id) {
            case net::ClientMessage::Craft: case net::ClientMessage::OracleCraft:
            case net::ClientMessage::Trade: case net::ClientMessage::TitanForge:
            case net::ClientMessage::Assemble: case net::ClientMessage::Absorb:
            case net::ClientMessage::BuyPetal:
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
        case net::ClientMessage::AdminTools: handleAdminTools(*session, connection, reader); break;
        case net::ClientMessage::PublishSkin:   handlePublishSkin(*session, connection, reader); break;
        case net::ClientMessage::EditSkin:      handleEditSkin(*session, connection, reader); break;
        case net::ClientMessage::EquipSkin:     handleEquipSkin(*session, connection, reader); break;
        case net::ClientMessage::DeleteSkin:    handleDeleteSkin(*session, connection, reader); break;
        case net::ClientMessage::VoteSkin:      handleVoteSkin(*session, connection, reader); break;
        case net::ClientMessage::FavoriteSkin:  handleFavoriteSkin(*session, connection, reader); break;
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
        if (session && session->authenticated()) connection.send(message);
    });
}

} // namespace flix
