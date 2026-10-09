// The admin dashboard: the server half of the panel `/admin gui` and the
// strip's admin button open.
//
// Who may use it is whoever the admin console answers -- a database admin, or
// the holder of a temporary grant (effectiveAdmin) -- and every request is
// checked again here; nothing is trusted from the panel being open. What it
// does is three things:
//
//  * It LISTS the flowers in the world, a page at a time, by connection: the
//    panel names a player back by that id, so it never has to type a name and
//    hope the server resolves it to the same person -- and with the account
//    name it picked the row as, which is checked against the id, since an id
//    outlives its account (a socket can sign in as someone else) and a
//    restarted server deals the same ids out again.
//
//  * Every request is billed to the console's command allowance, as the
//    console verbs it stands in for are (handleAdminDashboard says why).
//
//  * It shows one player's BAG, also a page at a time, out of the account's
//    own progress record -- which is what `give` writes. Not liveRecord(): in
//    the PVP ring that is the run's scratch kit, and a petal just given to the
//    account would not be in it.
//
//  * It lets an admin STEER another player's flower with their own input.
//
// Control is the part with rules, and they live here, in one place, for both
// of the roads that reach it: the panel's binary request and the console's
// `control` / `release` verbs (server/chat_commands.cpp).
//
//  * It is keyed by CONNECTION, with a back-reference on each side
//    (Session::controlling, Session::controlledBy). What is steered is the
//    target's ACTIVE half, looked up when it is needed, so a splitter switch
//    carries the control with it; and handleInput drops the target's own
//    input with one field test instead of a walk over every session.
//
//  * Every change of viewpoint goes through one door, restateView(): the
//    RealmChange that makes the client clear what it holds and snap its
//    camera, with the server's own view of that client reset in the same
//    breath. Resetting only the server side leaves the client holding every
//    entity it had -- including the old self, which is drawn on top of the
//    new one -- with nothing ever coming to remove them. switchSplitHalf
//    explains the self flag that makes this necessary.
//
//  * Each connection's own viewport claim stays on its own body. The admin's
//    stream is built around the steered flower but culled to the admin's own
//    window (Replicator::Frame::viewport); the steered player's claim goes on
//    culling theirs, deciding what they hear on Local and where mobs may be
//    put down out of their sight.
//
//  * It ends the moment it stops making sense, checked once a tick
//    (serviceControl) and on the spot by every way out of the world
//    (despawnPlayer, revokeTempAdmin, a socket signing in as somebody else):
//    either side stopped playing or died, the two are in different realms, or
//    the admin no longer has the standing they took the flower with.
//
//  * A temporary grantee may not take a full admin's flower -- the same line
//    `mute` draws, so a grantee cannot lock out the admin who lent them the
//    console. Everyone else's they may.

#include "server/game_server.h"

#include <algorithm>
#include <cstdio>
#include <string>
#include <utility>
#include <vector>

#include "server/text.h"
#include "shared/game/config.h"
#include "shared/net/admin_dashboard.h"

namespace flix {

namespace {

using net::AdminDashboardOp;
using net::AdminDashboardReply;

ByteWriter beginReply(AdminDashboardReply kind) {
    ByteWriter w;
    w.u8(static_cast<std::uint8_t>(net::ServerMessage::AdminDashboard));
    w.u8(static_cast<std::uint8_t>(kind));
    return w;
}

/// Whether a body is gone or down: a corpse keeps its Dead tag until it is
/// replaced, and a body whose health ran out this tick is down before the
/// reaper has tagged it.
bool bodyDown(const World& world, Entity body) {
    if (body == NULL_ENTITY || !world.isAlive(body) || world.has<Dead>(body)) return true;
    const Health* health = world.tryGet<Health>(body);
    return health != nullptr && !health->alive();
}

Realm realmOfBody(const World& world, Entity body) {
    const Transform* transform = world.tryGet<Transform>(body);
    return transform != nullptr ? transform->realm : Realm::Overworld;
}

/// What a flower's nameplate says, which is what the world shows above it:
/// the name typed on the title screen, or the account's when none was.
std::string nameplateOf(const Session& session) {
    return session.displayName.empty() ? session.username : session.displayName;
}

/// The two System lines the steered player is given, so a flower that stops
/// answering its keys is never a mystery to the person at them.
constexpr const char* kControlTakenNotice =
    "<span style=\"color: #ffb74d;\">An admin is steering your flower for now.</span>";
constexpr const char* kControlEndedNotice =
    "<span style=\"color: #6eff6e;\">Your flower is yours to steer again.</span>";

} // namespace

// ---------------------------------------------------------------------------
// Requests
// ---------------------------------------------------------------------------

void GameServer::handleAdminDashboard(Session& session, net::Connection& connection,
                                      ByteReader& reader) {
    // Not a word to anyone else, as `/admin` answers a stranger: a panel that
    // said "you are not allowed" would be confirming there is one.
    if (!session.authenticated() || !effectiveAdmin(session)) return;

    const auto op = static_cast<AdminDashboardOp>(reader.u8());
    if (!reader.ok()) return;

    // Billed like the console command each op stands in for, from the same
    // allowance and with the same notice. The console's road to control is
    // billed, so this one was the way round it: a temporary grantee could
    // alternate Control and Release as fast as frames could be sent, and every
    // pair cost its target two System lines -- a whole transcript replaced in
    // one burst -- and the log two more, with a map grid back to the sender
    // each time. The pages are billed too: each is a sort -- over every
    // session, or over a whole bag -- and the panel asks for one per click or
    // per pause in typing, which the twelve-deep bucket never notices.
    // Refused out loud, so the panel stops waiting for the answer it is not
    // going to get.
    if (!spend(session.commandAllowance)) {
        const std::string tooQuickly = "You are sending commands too quickly.";
        sendNotice(connection, net::NoticeSeverity::Warning, tooQuickly);
        ByteWriter w = beginReply(AdminDashboardReply::Refused);
        w.u8(static_cast<std::uint8_t>(op));
        w.str(tooQuickly);
        connection.send(w);
        return;
    }

    switch (op) {
        case AdminDashboardOp::Players: {
            const std::string search = reader.str();
            const std::uint32_t offset = reader.u32();
            if (!reader.ok()) return;
            sendDashboardPlayers(connection, search, offset);
            return;
        }
        case AdminDashboardOp::Inventory: {
            const net::ConnectionId target = reader.u32();
            const std::string username = reader.str();
            const std::uint32_t offset = reader.u32();
            if (!reader.ok()) return;
            sendDashboardInventory(connection, target, username, offset);
            return;
        }
        case AdminDashboardOp::Control: {
            const net::ConnectionId id = reader.u32();
            const std::string username = reader.str();
            if (!reader.ok()) return;
            // By connection, which is what the list named the row by -- and
            // only while that connection is still the account the row was
            // picked as. A row the panel drew a moment ago may be somebody who
            // has since left, a socket that is not signed in as anyone any
            // more, or, under the same id, another account altogether: one
            // that signed in on that socket, or whoever a restarted server
            // happened to number the same.
            Session* target = sessionFor(id);
            std::string answer;
            bool ok = false;
            if (target == nullptr || !target->authenticated() || target->username != username) {
                answer = "That player has left.";
            } else {
                ok = controlFlower(session, *target, answer);
            }
            sendDashboardResult(connection, ok, answer);
            return;
        }
        case AdminDashboardOp::Release: {
            std::string answer;
            const bool ok = releaseFlower(session, answer);
            sendDashboardResult(connection, ok, answer);
            return;
        }
    }
}

void GameServer::sendDashboardPlayers(net::Connection& connection, const std::string& search,
                                      std::uint32_t offset) {
    const std::string needle = lowerCase(trimmed(search));

    struct Row {
        const Session* session;
        std::string key;   ///< the account name, lower-cased, which is the order
    };
    std::vector<Row> rows;
    for (const auto& entry : sessions_) {
        const Session& other = entry.second;
        if (!other.playing()) continue;
        std::string key = lowerCase(other.username);
        // The account OR the nameplate: an admin looking for a flower reads
        // its nameplate off the screen, and the account is what every command
        // takes. Case-blind on both, as the console's own lookups are.
        if (!needle.empty() && key.find(needle) == std::string::npos &&
            lowerCase(nameplateOf(other)).find(needle) == std::string::npos) {
            continue;
        }
        rows.push_back({&other, std::move(key)});
    }
    // By account name, and by the exact spelling and then the connection
    // under that, so the order is total: the session table is a hash map, and
    // a list whose rows traded places between two pages would show one player
    // twice and another never.
    std::sort(rows.begin(), rows.end(), [](const Row& a, const Row& b) {
        if (a.key != b.key) return a.key < b.key;
        if (a.session->username != b.session->username) {
            return a.session->username < b.session->username;
        }
        return a.session->connection < b.session->connection;
    });

    const std::size_t total = rows.size();
    const std::size_t first = std::min<std::size_t>(offset, total);
    const std::size_t count = std::min<std::size_t>(net::kAdminDashboardPageSize, total - first);

    ByteWriter w = beginReply(AdminDashboardReply::Players);
    w.str(search);
    w.u32(static_cast<std::uint32_t>(first));
    w.u32(static_cast<std::uint32_t>(total));
    w.u16(static_cast<std::uint16_t>(count));
    for (std::size_t i = first; i < first + count; ++i) {
        const Session& other = *rows[i].session;
        net::AdminDashboardPlayer row;
        row.connection = other.connection;
        row.username = other.username;
        row.name = nameplateOf(other);
        row.realm = realmOfBody(world_, other.entity);
        if (bodyDown(world_, other.entity)) row.flags |= net::AdminDashboardDead;
        if (other.controlledBy != 0) row.flags |= net::AdminDashboardControlled;
        if (other.controlling != 0) row.flags |= net::AdminDashboardControlling;
        net::writeAdminDashboardPlayer(w, row);
    }
    connection.send(w);
}

void GameServer::sendDashboardInventory(net::Connection& connection, net::ConnectionId target,
                                        const std::string& username, std::uint32_t offset) {
    ByteWriter w = beginReply(AdminDashboardReply::Inventory);
    w.u32(target);
    const Session* owner = sessionFor(target);
    if (owner == nullptr || !owner->authenticated() || owner->username != username) {
        // Gone, signed out, or another account on the same id: an empty name
        // is the panel's cue to let the row go rather than to draw an empty
        // bag under it -- or somebody else's bag under this player's name.
        w.str(std::string());
        w.u32(0);
        w.u32(0);
        w.u16(0);
        connection.send(w);
        return;
    }

    // findProgress, not progress(): a look neither creates a record nor drops
    // the row's cached save text (see Database::Table).
    std::vector<net::AdminDashboardStack> stacks;
    if (const PlayerRecord* record = database_.findProgress(owner->userId)) {
        for (const std::string& rarityName : record->inventory.keys()) {
            const Rarity rarity = parseRarity(rarityName);
            const Json& byType = record->inventory[rarityName];
            for (const std::string& key : byType.keys()) {
                const auto count = static_cast<std::uint32_t>(PlayerRecord::stackCount(byType[key]));
                if (count == 0) continue;
                // A key this build has no petal for is left out of the view,
                // exactly as the profile leaves it out, and left in the record.
                const std::uint16_t index = petalIndexFromInventoryKey(key);
                if (index == kInvalidIndex) continue;
                stacks.push_back({index, rarity, count});
            }
        }
    }
    // The best tier first, which is what an admin opening somebody's bag has
    // usually come to find, then the petal's own catalogue order: a stored
    // object's key order is the file's, and pages cut from an order that is
    // not total could repeat a stack or skip one.
    std::sort(stacks.begin(), stacks.end(),
              [](const net::AdminDashboardStack& a, const net::AdminDashboardStack& b) {
                  if (a.rarity != b.rarity) return rarityIndex(a.rarity) > rarityIndex(b.rarity);
                  return a.petalIndex < b.petalIndex;
              });

    const std::size_t total = stacks.size();
    const std::size_t first = std::min<std::size_t>(offset, total);
    const std::size_t count = std::min<std::size_t>(net::kAdminDashboardPageSize, total - first);
    w.str(owner->username);
    w.u32(static_cast<std::uint32_t>(first));
    w.u32(static_cast<std::uint32_t>(total));
    w.u16(static_cast<std::uint16_t>(count));
    for (std::size_t i = first; i < first + count; ++i) net::writeAdminDashboardStack(w, stacks[i]);
    connection.send(w);
}

void GameServer::sendDashboardResult(net::Connection& connection, bool ok,
                                     const std::string& message) {
    ByteWriter w = beginReply(AdminDashboardReply::Result);
    w.boolean(ok);
    w.str(message);
    connection.send(w);
}

void GameServer::sendControlState(const Session& controller) {
    net::Connection* connection = listener_.find(controller.connection);
    if (connection == nullptr) return;
    const auto it = controller.controlling != 0 ? sessions_.find(controller.controlling)
                                                : sessions_.end();
    const bool active = it != sessions_.end();
    ByteWriter w = beginReply(AdminDashboardReply::Control);
    w.boolean(active);
    w.u32(active ? it->second.connection : 0);
    w.str(active ? it->second.username : std::string());
    connection->send(w);
}

// ---------------------------------------------------------------------------
// Control
// ---------------------------------------------------------------------------

std::string GameServer::controlRefusal(const Session& admin, const Session& target) const {
    // The admin's own side first: what they are already doing decides whether
    // they can start at all, whoever they asked for.
    if (!admin.playing()) return "You need a flower in the world to control another one.";
    if (admin.controlledBy != 0) {
        return "Someone is controlling your flower. You cannot control another until they "
               "release it.";
    }
    if (admin.controlling != 0) {
        const auto it = sessions_.find(admin.controlling);
        const std::string name =
            it != sessions_.end() ? it->second.username : std::string("another flower");
        return "You are already controlling " + name + ". Release it first.";
    }
    // Either half of a split flower is this same session, so this one test
    // refuses both of the player's own bodies.
    if (&target == &admin) return "You cannot control your own flower.";
    if (!target.playing()) return target.username + " is not in the world.";
    // mute's rule, and its words: a grant lent for one life does not reach
    // the admin who lent it. Before anything else about the target, so a
    // grantee cannot learn where a full admin is or how they are doing.
    if (!admin.admin && target.admin) {
        return target.username + " is a full admin and cannot be controlled.";
    }
    if (bodyDown(world_, admin.entity)) return "Your flower is dead.";
    if (bodyDown(world_, target.entity)) return target.username + "'s flower is dead.";
    if (realmOfBody(world_, admin.entity) != realmOfBody(world_, target.entity)) {
        return target.username + " is in another realm.";
    }
    if (target.controlledBy != 0) return target.username + "'s flower is already being controlled.";
    // Steering a flower whose player is steering a third would leave nobody
    // steering the third: that player's own input is what control drops.
    if (target.controlling != 0) return target.username + " is controlling another flower.";
    return {};
}

std::string GameServer::controlLapse(const Session& controller) const {
    const auto it = sessions_.find(controller.controlling);
    if (it == sessions_.end()) return "Control ended: that player has left.";
    const Session& target = it->second;
    if (!effectiveAdmin(controller)) return "Control ended: your admin access ended.";
    if (!controller.admin && target.admin) {
        return "Control ended: " + target.username + " is a full admin.";
    }
    if (!target.playing()) return "Control ended: " + target.username + " left the world.";
    if (!controller.playing()) return "Control ended: you left the world.";
    if (bodyDown(world_, controller.entity)) return "Control ended: your flower died.";
    if (bodyDown(world_, target.entity)) {
        return "Control ended: " + target.username + "'s flower died.";
    }
    if (realmOfBody(world_, controller.entity) != realmOfBody(world_, target.entity)) {
        return "Control ended: you and " + target.username + " are in different realms now.";
    }
    return {};
}

bool GameServer::controlFlower(Session& admin, Session& target, std::string& answer) {
    answer = controlRefusal(admin, target);
    if (!answer.empty()) return false;
    beginControl(admin, target);
    answer = "Controlling " + target.username +
             "'s flower. Your movement and attacks steer it now; use release to stop.";
    return true;
}

bool GameServer::releaseFlower(Session& admin, std::string& answer) {
    if (admin.controlling == 0) {
        answer = "You are not controlling a flower.";
        return false;
    }
    const auto it = sessions_.find(admin.controlling);
    const std::string name = it != sessions_.end() ? it->second.username : std::string();
    endControl(admin, std::string(), true);
    answer = name.empty() ? std::string("Flower control released.")
                          : "Released " + name + "'s flower.";
    return true;
}

void GameServer::beginControl(Session& admin, Session& target) {
    admin.controlling = target.connection;
    target.controlledBy = admin.connection;
    // Neither body goes on doing what it was last told. The admin's own
    // flower stops where it stands -- nothing steers it now -- and the one
    // taken over stops walking its player's last heading until the admin's
    // first input lands on it.
    parkBody(admin.entity);
    parkBody(target.entity);
    // The admin's client is about to watch through another body: everything
    // it holds is restated from first sight around that one, flagged self.
    restateView(admin);
    sendControlState(admin);
    if (net::Connection* peer = listener_.find(target.connection)) {
        sendSystem(*peer, kControlTakenNotice);
    }
    // The console's echo reaches the sender alone, and the panel's request
    // leaves no line at all, so the log is the one record of who steered whom.
    std::printf("[admin] %s is controlling %s's flower\n", admin.username.c_str(),
                target.username.c_str());
}

void GameServer::endControl(Session& controller, const std::string& why, bool restate) {
    Session* target = sessionFor(controller.controlling);
    controller.controlling = 0;
    if (target != nullptr && target->controlledBy == controller.connection) {
        target->controlledBy = 0;
        // The body that stops being steered stops: left alone it would walk
        // the admin's last heading until its own player's next input arrived.
        // Whenever the body is still there, not only while its session is
        // Playing: a control that lapses because the target stopped playing
        // is exactly the case where nothing else will ever steer it again.
        if (world_.isAlive(target->entity)) parkBody(target->entity);
        if (net::Connection* peer = listener_.find(target->connection)) {
            sendSystem(*peer, kControlEndedNotice);
        }
        std::printf("[admin] %s released %s's flower%s%s\n", controller.username.c_str(),
                    target->username.c_str(), why.empty() ? "" : ": ", why.c_str());
    }
    if (restate && controller.playing()) restateView(controller);
    sendControlState(controller);
    if (!why.empty()) {
        if (net::Connection* connection = listener_.find(controller.connection)) {
            sendSystem(*connection, escapedMarkup(why));
        }
    }
}

void GameServer::endControlOf(Session& session, const std::string& why, bool leaving) {
    // The flower this session is steering goes back to its player. Nothing to
    // tell this session: it is the one leaving, or changing account.
    if (session.controlling != 0) endControl(session, std::string(), !leaving);
    // Whoever is steering THIS flower is put back on their own, and told what
    // became of the one they had.
    if (session.controlledBy != 0) {
        if (Session* controller = sessionFor(session.controlledBy)) {
            endControl(*controller, "Control ended: " + session.username + " " + why + ".", true);
        }
        session.controlledBy = 0;
    }
}

void GameServer::serviceControl() {
    for (auto& entry : sessions_) {
        Session& session = entry.second;
        // A back-reference whose other end has let go -- which no path leaves
        // behind, and which would leave a flower deaf to its own player for
        // good -- is dropped rather than trusted.
        if (session.controlledBy != 0) {
            const auto it = sessions_.find(session.controlledBy);
            if (it == sessions_.end() || it->second.controlling != session.connection) {
                session.controlledBy = 0;
            }
        }
        if (session.controlling == 0) continue;
        const std::string why = controlLapse(session);
        if (!why.empty()) endControl(session, why, true);
    }
}

Entity GameServer::viewpointOf(const Session& session) const {
    if (session.controlling == 0) return session.entity;
    const auto it = sessions_.find(session.controlling);
    // Never taken while control holds -- every way out of the world ends it
    // first -- but a viewpoint has to be SOME body, and the session's own is
    // the one its client would be restated onto anyway.
    if (it == sessions_.end() || !it->second.playing()) return session.entity;
    return it->second.entity;
}

void GameServer::restateView(Session& session) {
    const Transform* at = world_.tryGet<Transform>(viewpointOf(session));
    sendRealmChange(session, at != nullptr ? at->position : Vec2{});
}

void GameServer::followControlledHalf(Session& target) {
    if (target.controlledBy == 0) return;
    if (Session* controller = sessionFor(target.controlledBy)) restateView(*controller);
}

void GameServer::releaseOnAccountChange(Session& session, const std::string& incomingUserId) {
    if (session.userId == incomingUserId) return;
    endControlOf(session, "signed out", false);
    revokeTempAdmin(session.connection);
    // The squad goes too, and with it any squad invitation waiting on this
    // socket (SquadRoster::leave drops both). Both are keyed by CONNECTION
    // (squadIdOf), so without this the account signing in next inherited the
    // last one's party -- its roster, its /s chat, its share of the loot
    // ranking, its leadership -- without anybody asking it, and could accept
    // an invitation that was sent to somebody else. Here, before the new
    // account is installed, so the line the squad is told names whoever
    // actually left; with the connection, because a sign-in as somebody else
    // is no forgetAccount() on the client and its party bar has to be told.
    departSquad(session, listener_.find(session.connection),
                squadDisplayName(squadIdOf(session)));
}

} // namespace flix
