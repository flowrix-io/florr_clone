// Squads in the world. The rules are server/squads.h. What lives here is
// everything those rules deliberately know nothing about: which body a member
// currently owns, what to call them, who to tell, and which biome they are in.

#include "server/game_server.h"

#include <utility>
#include <vector>

#include "server/text.h"

namespace flix {

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
        return session->nameplate();
    }
    return squadAccountName(member);
}

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
        rows.emplace_back(member, squadEntityOf(member));
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
        if (squad->leader == row.first && row.second == squadEntityOf(row.first)) flags |= 1u;
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
    // On the Squad channel rather than System, which is what tells a member
    // whether a line was said to the world or to the four of them. No author:
    // it is the server's notice, and the client colours it as the squad's.
    for (const SquadMemberId& member : squad.members) {
        if (net::Connection* peer = squadConnection(member)) {
            sendChatTo(*peer, net::ChatChannel::Squad, "", text);
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
    tellSquadOfDeparture(departure, leaverName);
}

void GameServer::tellSquadOfDeparture(const SquadRoster::Departure& departure,
                                      const std::string& leaverName) {
    Squad* remaining = squads_.find(departure.squadId);
    if (remaining == nullptr) return;
    // Promotion first, then the departure: that is the order the reference
    // emits them in, because the promotion happens inside its leaveSquad and
    // the "has left" line is said by the caller afterwards.
    // Nameplates are escaped wherever they land in a notice: the client reads
    // these lines as markup, and a nameplate is whatever its player typed.
    if (departure.promoted.valid()) {
        sendSquadSystem(*remaining, escapedMarkup(squadDisplayName(departure.promoted)) +
                                        " is now the squad leader.");
    }
    sendSquadSystem(*remaining, escapedMarkup(leaverName) + " has left the squad.");
    broadcastSquadUpdate(*remaining);
}

void GameServer::removeBotFromSquad(Entity body) {
    const SquadMemberId member = SquadMemberId::ofBot(body);
    if (squads_.forMember(member) == nullptr) return;
    // Read while the body is still alive: a destroyed bot has no nameplate to
    // put in the line its squad is about to be sent.
    const std::string name = squadDisplayName(member);
    tellSquadOfDeparture(squads_.leave(member), name);
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
            const Entity body = squadEntityOf(member);
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
        const Entity body = squadEntityOf(member);
        if (body != NULL_ENTITY) out.push_back(body);
    }
}

} // namespace flix
