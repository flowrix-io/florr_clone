// Guilds as players use them: creating, editing, inviting, joining, leaving
// and kicking, the roster every member is sent, and squads raised from a
// guild. The naming rules are server/guilds.h.

#include "server/game_server.h"

#include <algorithm>
#include <unordered_map>

#include "server/guilds.h"
#include "server/text.h"

namespace flix {

namespace {

/// The refusal for a display name validGuildDisplayName turns down.
std::string guildDisplayNameRule() {
    return "Guild name must be 1-" + std::to_string(kMaxGuildDisplayName) +
           " letters, digits, spaces or punctuation.";
}

/// Takes the member at `at` off the roster.
void removeGuildMember(Json& guild, int at) {
    std::vector<Json>& members = guild["memberUsernames"].items();
    members.erase(members.begin() + at);
}

/// The line a guildmate is invited into `inviter`'s squad with.
std::string guildSquadInviteLine(const std::string& inviter) {
    return "<span style=\"color: #4fc3f7;\">@" + inviter +
           " (guild) invited you to their squad. Use /squad-accept or /squad-decline.</span>";
}

} // namespace

std::string GameServer::guildNameForUser(const std::string& username) const {
    if (username.empty()) return {};
    const Json& guilds = database_.storedTable("guilds");
    if (!guilds.isObject()) return {};
    for (const std::string& key : guilds.keys()) {
        if (guildMemberIndex(guilds[key], username) >= 0) return key;
    }
    return {};
}

std::string GameServer::guildOf(const Session& session, net::Connection& connection) {
    std::string name = guildNameForUser(session.username);
    if (name.empty()) sendNotice(connection, net::NoticeSeverity::Warning, "You are not in a guild.");
    return name;
}

std::string GameServer::guildLedBy(const Session& session, net::Connection& connection,
                                   const char* action) {
    std::string name = guildOf(session, connection);
    if (name.empty()) return name;
    if (!isGuildLeader(database_.storedTable("guilds")[name], session.username)) {
        sendNotice(connection, net::NoticeSeverity::Warning,
                   std::string("Only the guild leader can ") + action + ".");
        return {};
    }
    return name;
}

ByteWriter GameServer::guildRosterMessage(const Json& guild) {
    const Json& members = guild["memberUsernames"];

    // Everyone signed in, by lower-cased name, once per message rather than
    // once per member: sessionForUser is a walk of every session, and a full
    // guild asked it two hundred times.
    std::unordered_map<std::string, const Session*> signedIn;
    for (const auto& [id, session] : sessions_) {
        if (session.authenticated()) signedIn[lowerCase(session.username)] = &session;
    }

    ByteWriter w;
    w.u8(static_cast<std::uint8_t>(net::ServerMessage::GuildUpdate));
    w.boolean(true);
    w.str(guild["name"].asString());
    w.str(guildDisplayName(guild));
    w.str(guild["description"].asString());
    w.str(guild["leaderUsername"].asString());
    w.u16(static_cast<std::uint16_t>(members.size()));
    for (std::size_t i = 0; i < members.size(); ++i) {
        const std::string member = members[i].asString();
        const auto found = signedIn.find(lowerCase(member));
        const Session* session = found != signedIn.end() ? found->second : nullptr;
        w.str(member);
        w.boolean(session != nullptr);
        w.str(session != nullptr ? guildLocation(*session) : std::string());
    }
    return w;
}

std::string GameServer::guildLocation(const Session& session) const {
    return biomeLabel(biomeOfEntity(session.entity));
}

void GameServer::serviceGuildPresence(double nowMillis) {
    // Once a second: a roster that names the biome a member is in is allowed
    // to be a second behind them, and a walk of every session every tick to
    // find out nobody moved is not worth having.
    constexpr double kIntervalMillis = 1000.0;
    if (nowMillis < nextGuildPresenceMillis_) return;
    nextGuildPresenceMillis_ = nowMillis + kIntervalMillis;

    std::unordered_map<std::string, std::string> now;
    for (const auto& [id, session] : sessions_) {
        if (!session.authenticated() || session.username.empty()) continue;
        now[lowerCase(session.username)] = guildLocation(session);
    }

    std::vector<std::string> moved;
    for (const auto& [name, location] : now) {
        const auto was = guildPresence_.find(name);
        if (was == guildPresence_.end() || was->second != location) moved.push_back(name);
    }
    for (const auto& [name, location] : guildPresence_) {
        if (now.find(name) == now.end()) moved.push_back(name);
    }
    guildPresence_ = std::move(now);
    if (moved.empty()) return;

    // One roster per guild however many of its members moved.
    std::vector<std::string> guildNames;
    for (const std::string& name : moved) {
        const std::string guild = guildNameForUser(name);
        if (guild.empty()) continue;
        if (std::find(guildNames.begin(), guildNames.end(), guild) == guildNames.end()) {
            guildNames.push_back(guild);
        }
    }
    const Json& guilds = database_.storedTable("guilds");
    for (const std::string& guild : guildNames) broadcastGuildRoster(guilds[guild]);
}

void GameServer::sendNoGuild(net::Connection& connection) {
    ByteWriter w;
    w.u8(static_cast<std::uint8_t>(net::ServerMessage::GuildUpdate));
    w.boolean(false);
    connection.send(w);
}

void GameServer::broadcastGuildRoster(const Json& guild) {
    // Addressed member by member -- the roster is only sent to people in the
    // guild, and there is no room concept here to address them as a group --
    // but built once, since it says the same thing to every one of them.
    const Json& members = guild["memberUsernames"];
    if (members.size() == 0) return;
    const ByteWriter message = guildRosterMessage(guild);
    for (std::size_t i = 0; i < members.size(); ++i) {
        if (net::Connection* peer = connectionForUser(members[i].asString())) {
            peer->send(message);
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

void GameServer::sendGuildSystem(const Json& guild, const std::string& text) {
    // The squad's notice, for a guild: on its own channel, with no author.
    const Json& members = guild["memberUsernames"];
    for (std::size_t i = 0; i < members.size(); ++i) {
        if (net::Connection* peer = connectionForUser(members[i].asString())) {
            sendChatTo(*peer, net::ChatChannel::Guild, "", text);
        }
    }
}

void GameServer::handleGuildCreate(Session& session, net::Connection& connection,
                                   ByteReader& reader) {
    const std::string tag = reader.str();
    const std::string displayName = reader.str();
    if (!reader.ok() || !session.authenticated()) return;
    guildCreate(session, connection, tag, displayName);
}

void GameServer::guildCreate(Session& session, net::Connection& connection,
                             const std::string& raw, const std::string& rawDisplayName) {
    if (!session.authenticated()) return;

    const std::string name = normalizeGuildName(raw);
    if (name.empty()) {
        sendNotice(connection, net::NoticeSeverity::Warning, "Guild tag cannot be empty.");
        return;
    }
    if (!validGuildName(name)) {
        sendNotice(connection, net::NoticeSeverity::Warning,
                   "Guild tag must be exactly 5 alphanumeric characters (A–Z, 0–9).");
        return;
    }
    // No display name is the tag: the card always has something to say.
    const std::string displayName =
        trimmed(rawDisplayName).empty() ? name : trimmed(rawDisplayName);
    if (!validGuildDisplayName(displayName)) {
        sendNotice(connection, net::NoticeSeverity::Warning, guildDisplayNameRule());
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
    guild["displayName"] = displayName;
    guild["description"] = std::string();
    guild["leaderUsername"] = session.username;
    Json members = Json::array();
    members.push(session.username);
    guild["memberUsernames"] = std::move(members);
    guild["createdAt"] = static_cast<double>(database_.nowMillis());
    guilds[name] = std::move(guild);
    database_.markDirty();

    sendNotice(connection, net::NoticeSeverity::Good,
               "Guild \"" + escapedMarkup(displayName) + "\" [" + name + "] created.");
    broadcastGuildRoster(guilds[name]);
}

void GameServer::handleGuildEdit(Session& session, net::Connection& connection,
                                 ByteReader& reader) {
    const std::string displayName = reader.str();
    const std::string description = reader.str();
    if (!reader.ok() || !session.authenticated()) return;
    guildEdit(session, connection, displayName, description);
}

void GameServer::guildEdit(Session& session, net::Connection& connection,
                           const std::optional<std::string>& rawDisplayName,
                           const std::optional<std::string>& rawDescription) {
    if (!session.authenticated()) return;

    const std::string guildName = guildLedBy(session, connection, "edit the guild");
    if (guildName.empty()) return;
    Json& guild = database_.rawTable("guilds")[guildName];

    // Both checked before either is written, so a refusal changes nothing.
    std::string displayName;
    if (rawDisplayName) {
        displayName = trimmed(*rawDisplayName);
        if (!validGuildDisplayName(displayName)) {
            sendNotice(connection, net::NoticeSeverity::Warning, guildDisplayNameRule());
            return;
        }
    }
    std::string description;
    if (rawDescription) {
        description = trimmed(*rawDescription);
        if (!validGuildDescription(description)) {
            sendNotice(connection, net::NoticeSeverity::Warning,
                       "Guild description must be at most " +
                           std::to_string(kMaxGuildDescription) +
                           " letters, digits, spaces or punctuation.");
            return;
        }
    }

    const Json& stored = guild;
    const bool renamed = rawDisplayName && displayName != guildDisplayName(stored);
    const bool redescribed = rawDescription && description != stored["description"].asString();
    if (!renamed && !redescribed) return;
    if (renamed) guild["displayName"] = displayName;
    if (redescribed) guild["description"] = description;
    database_.markDirty();

    sendNotice(connection, net::NoticeSeverity::Good, "Guild updated.");
    broadcastGuildRoster(guild);
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

    const std::string guildName = guildLedBy(session, connection, "invite players");
    if (guildName.empty()) return;
    const Json& guild = database_.storedTable("guilds")[guildName];
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

    guildInvites_[key] = {guildName, now + kGuildInviteMillis};
    sendNotice(connection, net::NoticeSeverity::Good, "Guild invite sent to " + target + ".");

    if (net::Connection* peer = connectionForUser(target)) {
        ByteWriter w;
        w.u8(static_cast<std::uint8_t>(net::ServerMessage::GuildInviteReceived));
        w.str(guildName);
        w.str(session.username);
        w.str(guildDisplayName(guild));
        peer->send(w);
        sendNotice(*peer, net::NoticeSeverity::Info,
                   "@" + session.username + " has invited you to guild \"" +
                       escapedMarkup(guildDisplayName(guild)) + "\" [" + guildName +
                       "]. Use /guild-accept or /guild-decline.");
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

    sendGuildSystem(guild, session.username + " has joined the guild.");
    broadcastGuildRoster(guild);
}

void GameServer::handleGuildDecline(Session& session, net::Connection& connection) {
    if (!session.authenticated()) return;
    guildInvites_.erase(lowerCase(session.username));
    sendNotice(connection, net::NoticeSeverity::Info, "Guild invite declined.");
}

void GameServer::handleGuildLeave(Session& session, net::Connection& connection) {
    if (!session.authenticated()) return;
    const std::string guildName = guildOf(session, connection);
    if (guildName.empty()) return;

    Json& guilds = database_.rawTable("guilds");
    Json& guild = guilds[guildName];
    const int at = guildMemberIndex(guild, session.username);
    if (at >= 0) removeGuildMember(guild, at);

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
    if (isGuildLeader(guild, session.username)) {
        promoted = guild["memberUsernames"][std::size_t{0}].asString();
        guild["leaderUsername"] = promoted;
    }
    database_.markDirty();

    sendGuildSystem(guild, session.username + " has left the guild.");
    if (!promoted.empty()) sendGuildSystem(guild, promoted + " is now the guild leader.");
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

    const std::string guildName = guildLedBy(session, connection, "kick players");
    if (guildName.empty()) return;
    const std::string target = trimmed(raw);
    if (lowerCase(target) == lowerCase(session.username)) {
        sendNotice(connection, net::NoticeSeverity::Warning,
                   "You cannot kick yourself. Use /guild-leave instead.");
        return;
    }
    const int at = guildMemberIndex(database_.storedTable("guilds")[guildName], target);
    if (at < 0) {
        sendNotice(connection, net::NoticeSeverity::Warning, target + " is not in your guild.");
        return;
    }

    // The stored spelling, not what the leader typed: the kicked player's own
    // messages read back the name their account carries.
    Json& guild = database_.rawTable("guilds")[guildName];
    const std::string member = guild["memberUsernames"][static_cast<std::size_t>(at)].asString();
    removeGuildMember(guild, at);
    database_.markDirty();

    sendGuildSystem(guild, member + " was kicked from the guild by " + session.username + ".");
    if (net::Connection* peer = connectionForUser(member)) {
        sendNoGuild(*peer);
        sendNotice(*peer, net::NoticeSeverity::Bad,
                   "You were kicked from guild \"" + guildName + "\".");
    }
    broadcastGuildRoster(guild);
}

void GameServer::handleGuildSquadAll(Session& session, net::Connection& connection) {
    if (!session.authenticated()) return;
    const std::string guildName = guildOf(session, connection);
    if (guildName.empty()) return;
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
        if (!squads_.invite(squadIdOf(session), squadIdOf(*target), now).empty()) {
            continue;
        }
        ++invited;
        if (net::Connection* peer = listener_.find(target->connection)) {
            sendSystem(*peer, guildSquadInviteLine(session.username));
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
        squads_.invite(squadIdOf(session), squadIdOf(*peerSession),
                       static_cast<std::int64_t>(clockMillis_));
    if (!error.empty()) {
        sendNotice(connection, net::NoticeSeverity::Warning, error);
        return;
    }
    sendNotice(connection, net::NoticeSeverity::Good, "Squad invite sent to " + target + ".");
    if (net::Connection* peer = listener_.find(peerSession->connection)) {
        sendSystem(*peer, guildSquadInviteLine(session.username));
    }
}

} // namespace flix
