// The chat command surface: everything a player can type that begins with '/'.
//
// This build used to have none. handleChat sanitised the line and broadcast
// it, so "/help" reached every player as the literal text "/help" and the
// command table the client offers in its autocomplete answered nothing at all.
//
// Three rules run through the whole file:
//
//  * A slash line is never broadcast. It is answered, refused, or reported
//    unknown. handleChatCommand returning true is what says "dealt with".
//
//  * Output is one System chat line per line. The browser build joins its
//    output with `<br/>` inside one message because it renders HTML; this
//    client renders text, and one message per line is what its transcript
//    wraps correctly.
//
//  * A command with no counterpart in this build says so, by name. The client
//    advertises the browser server's whole table, and a player who types
//    `/admin update` deserves "not available on this server" rather than
//    silence or a misleading "unknown command".

#include "server/game_server.h"

#include <algorithm>
#include <array>
#include <cctype>
#include <cmath>
#include <cstdio>
#include <string>
#include <vector>

#include "server/bot_identity.h"
#include "server/guilds.h"
#include "server/systems/spawning.h"
#include "server/text.h"
#include "shared/game/config.h"
#include "shared/game/constants.h"
#include "shared/game/terrain.h"

namespace flr {

namespace {

/// A temporary grant lasts one life, so the console it unlocks is deliberately
/// smaller than a full admin's. These are the commands a grantee may NOT run:
/// anything that hands out permissions, silences somebody, or edits accounts.
/// Without this list a grantee could grant themselves a successor and keep the
/// chain alive past their own respawn, which is the one thing the expiry is
/// there to prevent.
bool grantableCommand(const std::string& verb) {
    static const std::array<const char*, 6> kFullAdminOnly = {
        "grant_admin", "revoke_admin", "mute", "unmute", "delete_guests", "set_skin",
    };
    for (const char* reserved : kFullAdminOnly) {
        if (verb == reserved) return false;
    }
    return true;
}

/// Parses a decimal integer, whole-token. Returns false on anything with
/// trailing rubbish, so `spawn bee rare 10x` is a diagnostic rather than ten.
bool parseInteger(const std::string& text, int& out) {
    if (text.empty()) return false;
    std::size_t used = 0;
    long value = 0;
    try {
        value = std::stol(text, &used);
    } catch (...) {
        return false;
    }
    if (used != text.size()) return false;
    out = static_cast<int>(value);
    return true;
}

bool parseNumber(const std::string& text, double& out) {
    if (text.empty()) return false;
    std::size_t used = 0;
    double value = 0;
    try {
        value = std::stod(text, &used);
    } catch (...) {
        return false;
    }
    if (used != text.size() || !std::isfinite(value)) return false;
    out = value;
    return true;
}

/// The map is exactly kWorldSize on a side and nothing outside it is
/// meaningful: the terrain has no tiles there, the section lookup returns -1,
/// and a body parked past the edge is invisible to the spawner's whole
/// neighbourhood pass. Refusing is better than clamping, because a typo'd
/// coordinate should be reported rather than silently turned into a corner.
bool saneCoordinate(double v) {
    return std::isfinite(v) && v >= 0.0 && v <= kWorldSize;
}

/// Rarity by name, strictly -- unlike parseRarity(), which reads unknown text
/// as Common so a hand-edited save degrades instead of failing to load. A
/// typed command wants the typo reported.
bool parseRarityStrict(const std::string& text, Rarity& out) {
    const std::string key = lowerCase(text);
    for (int i = 0; i < kRarityCount; ++i) {
        if (key == kRarityNames[static_cast<std::size_t>(i)]) {
            out = static_cast<Rarity>(i);
            return true;
        }
    }
    return false;
}

std::string rarityList() {
    std::string out;
    for (int i = 0; i < kRarityCount; ++i) {
        if (i > 0) out += ", ";
        out += kRarityNames[static_cast<std::size_t>(i)];
    }
    return out;
}

std::string joined(const std::vector<std::string>& words, std::size_t from) {
    std::string out;
    for (std::size_t i = from; i < words.size(); ++i) {
        if (!out.empty()) out += ' ';
        out += words[i];
    }
    return out;
}

/// Everything after the first run of whitespace, trimmed. The argument of a
/// one-argument command, kept whole so a guild name or a notification message
/// may contain spaces.
std::string argumentOf(const std::string& line) {
    const std::size_t space = line.find_first_of(" \t");
    if (space == std::string::npos) return {};
    return trimmed(line.substr(space + 1));
}

/// The verb: the first word, lower-cased.
std::string verbOf(const std::string& line) {
    const std::vector<std::string> words = splitWords(line);
    return words.empty() ? std::string() : lowerCase(words[0]);
}

std::string plural(int n, const char* singular, const char* many) {
    return std::to_string(n) + " " + (n == 1 ? singular : many);
}

/// "3m ago", "2h 5m ago", "just now" -- the browser build's own wording for
/// the last-active column.
std::string agoLabel(std::int64_t millis) {
    const long minutes = static_cast<long>(millis / 60000);
    if (minutes < 1) return "just now";
    if (minutes < 60) return std::to_string(minutes) + "m ago";
    return std::to_string(minutes / 60) + "h " + std::to_string(minutes % 60) + "m ago";
}

/// Eight characters of A-Z0-9, as the browser build mints them, so a code from
/// either server looks the same and pastes into the same shop field.
std::string mintCode(Rng& rng) {
    static const char kAlphabet[] = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
    std::string code;
    code.reserve(8);
    for (int i = 0; i < 8; ++i) code.push_back(kAlphabet[rng.below(36)]);
    return code;
}

/// The five type tags the browser stores against a notification.
bool validNotificationType(const std::string& type) {
    return type == "super_craft" || type == "unique_craft" || type == "apex_craft" ||
           type == "star_code";
}

} // namespace

// ---------------------------------------------------------------------------
// Plumbing
// ---------------------------------------------------------------------------

void GameServer::sendSystem(net::Connection& connection, const std::string& text) {
    sendChatTo(connection, net::ChatChannel::System, "System", text);
}

bool GameServer::effectiveAdmin(const Session& session) const {
    return session.admin || tempAdmins_.count(session.connection) != 0;
}

void GameServer::revokeTempAdmin(net::ConnectionId id) {
    if (tempAdmins_.erase(id) == 0) return;
    // The client learns its admin standing from the skin catalog's leading
    // flag, and that flag is what un-hides the admin rows in its command
    // autocomplete. Resending it is how a revoked console disappears from the
    // grantee's screen rather than lingering until their next login.
    if (Session* session = sessionFor(id)) {
        if (net::Connection* connection = listener_.find(id)) sendSkinCatalog(*session, *connection);
    }
}

bool GameServer::resolveCommandTarget(const std::string& identifier, CommandTarget& out) {
    const std::string key = lowerCase(trimmed(identifier));
    if (key.empty()) return false;

    // Account name first: it is the spelling an admin types, and it is unique.
    // A nameplate is neither -- two flowers may share one -- so it is only
    // consulted when nothing owns the name as an account.
    for (auto& entry : sessions_) {
        Session& session = entry.second;
        if (!session.playing()) continue;
        if (lowerCase(session.username) != key) continue;
        out = {session.entity, &session,
               session.displayName.empty() ? session.username : session.displayName};
        return true;
    }

    Query<PlayerTag, PlayerAccount> flowers{world_};
    Entity found = NULL_ENTITY;
    std::string foundName;
    flowers.each([&](Entity entity, PlayerTag&, PlayerAccount& account) {
        if (found != NULL_ENTITY) return;
        if (lowerCase(account.username) != key) return;
        found = entity;
        foundName = account.username;
    });
    if (found == NULL_ENTITY) return false;

    out = {found, sessionForEntity(found), foundName};
    return true;
}

void GameServer::teleportEntity(Entity entity, Vec2 position) {
    if (!world_.isAlive(entity)) return;
    if (Transform* transform = world_.tryGet<Transform>(entity)) transform->position = position;
    // Velocity and knockback are properties of where the body WAS going. A
    // flower dropped across the map still carrying the impulse that was
    // pushing it there arrives sliding.
    if (Motion* motion = world_.tryGet<Motion>(entity)) motion->velocity = {0, 0};
    if (Knockback* knockback = world_.tryGet<Knockback>(entity)) knockback->impulse = {0, 0};
    // No wire message: the client cuts its interpolation on any jump past
    // kTeleportSnapDistance (600 units) on its own, which every teleport worth
    // the name exceeds. One under that distance is close enough that easing to
    // it looks better than snapping.
}

// ---------------------------------------------------------------------------
// The '/' dispatch
// ---------------------------------------------------------------------------

bool GameServer::handleChatCommand(Session& session, net::Connection& connection,
                                   const std::string& message) {
    if (message.empty() || message[0] != '/') return false;

    const std::string verb = verbOf(message);
    const std::string argument = argumentOf(message);

    // -- channel shorthands ------------------------------------------------

    if (verb == "/g") {
        if (argument.empty()) {
            sendSystem(connection, "Usage: /g <message>");
            return true;
        }
        const Account* account = database_.findUser(session.username);
        if (account != nullptr && account->muted) {
            sendSystem(connection, "You are muted and cannot send chat messages.");
            return true;
        }
        const std::string guildName = guildNameForUser(session.username);
        if (guildName.empty()) {
            sendSystem(connection, "You are not in a guild.");
            return true;
        }
        const Json& guild = database_.storedTable("guilds")[guildName];
        const Json& members = guild["memberUsernames"];
        for (std::size_t i = 0; i < members.size(); ++i) {
            if (net::Connection* peer = connectionForUser(members[i].asString())) {
                // The reference's own signature: "[Guild NAME] @username", so
                // the guild tag and the speaker both read off the sender line.
                sendChatTo(*peer, net::ChatChannel::System,
                           "[Guild " + guildName + "] @" + session.username, argument);
            }
        }
        return true;
    }

    if (verb == "/s" || verb.rfind("/squad-", 0) == 0) {
        sendSystem(connection, "Squads are not available on this server.");
        return true;
    }

    // -- the admin console -------------------------------------------------

    if (verb == "/admin" || verb == "/cmd") {
        if (!effectiveAdmin(session)) {
            // The browser build denies the command's EXISTENCE rather than the
            // permission, and so does this: telling a stranger that a console
            // is there is half of finding a way into it.
            sendSystem(connection, "Command does not exist.");
            return true;
        }
        if (argument.empty()) {
            sendSystem(connection, "Usage: /admin <command>. Try /help for the list.");
            return true;
        }
        runAdminCommand(session, connection, argument);
        return true;
    }

    // -- guilds ------------------------------------------------------------
    //
    // Routed into the same cores the guild panel's binary messages use, so the
    // two roads cannot disagree about who may do what.

    if (verb == "/guild-create") { guildCreate(session, connection, argument); return true; }
    if (verb == "/guild-invite") { guildInvite(session, connection, argument); return true; }
    if (verb == "/guild-kick")   { guildKick(session, connection, argument); return true; }
    if (verb == "/guild-accept") { handleGuildAccept(session, connection); return true; }
    if (verb == "/guild-decline"){ handleGuildDecline(session, connection); return true; }
    if (verb == "/guild-leave")  { handleGuildLeave(session, connection); return true; }
    if (verb == "/guild-squad")  { handleGuildSquadAll(session, connection); return true; }

    if (verb == "/guild-info") {
        const std::string guildName = guildNameForUser(session.username);
        if (guildName.empty()) {
            sendSystem(connection, "You are not in a guild.");
            return true;
        }
        const Json& guild = database_.storedTable("guilds")[guildName];
        const Json& members = guild["memberUsernames"];
        sendSystem(connection, "\"" + guildName + "\" - leader @" +
                                   guild["leaderUsername"].asString() + " - " +
                                   std::to_string(members.size()) + "/" +
                                   std::to_string(kMaxGuildSize));
        for (std::size_t i = 0; i < members.size(); ++i) {
            const std::string member = members[i].asString();
            sendSystem(connection,
                       "  " + member + (sessionForUser(member) != nullptr ? " (online)" : ""));
        }
        return true;
    }

    if (verb == "/guild-list") {
        const Json& guilds = database_.storedTable("guilds");
        if (!guilds.isObject() || guilds.keys().empty()) {
            sendSystem(connection, "No guilds exist.");
            return true;
        }
        sendSystem(connection, "Guilds (" + std::to_string(guilds.keys().size()) + "):");
        for (const std::string& key : guilds.keys()) {
            const Json& guild = guilds[key];
            sendSystem(connection, "  \"" + key + "\" - " +
                                       std::to_string(guild["memberUsernames"].size()) + "/" +
                                       std::to_string(kMaxGuildSize) + " - leader @" +
                                       guild["leaderUsername"].asString());
        }
        return true;
    }

    // -- account and world questions ---------------------------------------

    if (verb == "/biome") {
        // Every flower counts, bots included: the question is where the world
        // is busy, and a section full of bots is a section full of fights.
        std::array<int, kSectionCount> counts{};
        int total = 0;
        Query<PlayerTag, Transform> flowers{world_};
        flowers.each([&](Entity entity, PlayerTag&, Transform& transform) {
            if (world_.has<Dead>(entity)) return;
            const int section = sectionAt(transform.position);
            if (section < 0) return;
            ++counts[static_cast<std::size_t>(section)];
            ++total;
        });
        if (total == 0) {
            sendSystem(connection, "No players are currently in any section.");
            return true;
        }
        int best = 0;
        for (int i = 1; i < kSectionCount; ++i) {
            if (counts[static_cast<std::size_t>(i)] > counts[static_cast<std::size_t>(best)]) {
                best = i;
            }
        }
        sendSystem(connection, std::string("Most populated biome: ") + biomeOf(best).name + " (" +
                                   plural(counts[static_cast<std::size_t>(best)], "player",
                                          "players") +
                                   ")");
        for (int i = 0; i < kSectionCount; ++i) {
            const int count = counts[static_cast<std::size_t>(i)];
            if (count == 0) continue;
            sendSystem(connection,
                       std::string("  ") + biomeOf(i).name + ": " + std::to_string(count));
        }
        return true;
    }

    if (verb == "/level-from-string" || verb == "/loadout-from-string") {
        if (argument.empty()) {
            sendSystem(connection, "Usage: " + verb + " <name>");
            return true;
        }
        const BotIdentity identity = botIdentityForName(argument, kLoadoutActiveSlots, kMaxLevel);
        if (verb == "/level-from-string") {
            sendSystem(connection, "\"" + argument + "\" would be level " +
                                       std::to_string(identity.level) + ".");
            return true;
        }
        sendSystem(connection, "\"" + argument + "\" loadout:");
        for (std::size_t i = 0; i < identity.slots.size(); ++i) {
            const BotIdentity::Slot& slot = identity.slots[i];
            const std::string petal = slot.petalIndex == kInvalidIndex
                                          ? std::string("(none)")
                                          : content().petal(slot.petalIndex).id;
            sendSystem(connection, "  Slot " + std::to_string(i + 1) + ": " +
                                       rarityName(slot.rarity) + " " + petal);
        }
        return true;
    }

    if (verb == "/create-api-key") {
        // The key is minted into the same `apiKeys` table the browser build's
        // HTTP API authenticates against, so a key made here works there. THIS
        // build serves no HTTP API of its own, which the reply says outright
        // rather than leaving the holder to discover it against a closed port.
        const std::string label = argument.empty() ? session.username : argument;
        std::string body;
        Rng keyRng(static_cast<std::uint64_t>(database_.nowMillis()) ^
                   (static_cast<std::uint64_t>(hashName(session.userId)) << 21));
        static const char kAlphabet[] = "abcdefghijklmnopqrstuvwxyz0123456789";
        body.reserve(64);
        for (int i = 0; i < 64; ++i) body.push_back(kAlphabet[keyRng.below(36)]);
        const std::string key = "sk_" + body;

        Json entry = Json::object();
        entry["key"] = key;
        entry["username"] = session.username;
        entry["label"] = label;
        entry["createdAt"] = static_cast<double>(database_.nowMillis());
        database_.rawTable("apiKeys")[key] = std::move(entry);
        database_.markDirty();

        sendSystem(connection, "[API KEY CREATED] label: " + label);
        sendSystem(connection, key);
        sendSystem(connection, "Save it now - the full key is not shown again.");
        sendSystem(connection, session.admin
                                   ? "Your account is admin, so this key carries admin scope."
                                   : "Your account is not admin, so this key carries user scope.");
        sendSystem(connection, "Note: this server does not serve the HTTP API itself; the key is "
                               "for a browser-build API server sharing this database.");
        return true;
    }

    if (verb == "/delete-api-key") {
        if (argument.empty()) {
            sendSystem(connection, "Usage: /delete-api-key <key-or-prefix>");
            return true;
        }
        // Only this account's own keys are visible here, by prefix or in full.
        // Removing somebody else's stays an out-of-band operation, so the
        // command can never escalate across users however it is typed at.
        Json& keys = database_.rawTable("apiKeys");
        std::vector<std::string> owned;
        for (const std::string& key : keys.keys()) {
            if (lowerCase(keys[key]["username"].asString()) == lowerCase(session.username)) {
                owned.push_back(key);
            }
        }
        std::vector<std::string> matches;
        for (const std::string& key : owned) {
            if (key == argument) { matches.assign(1, key); break; }
            if (key.rfind(argument, 0) == 0) matches.push_back(key);
        }
        if (matches.empty()) {
            sendSystem(connection, "No API key of yours matched that key or prefix.");
            return true;
        }
        if (matches.size() > 1) {
            sendSystem(connection, "Prefix \"" + argument + "\" is ambiguous - it matches " +
                                       std::to_string(matches.size()) +
                                       " of your keys. Provide more characters.");
            return true;
        }
        const std::string label = keys[matches[0]]["label"].asString();
        keys.erase(matches[0]);
        database_.markDirty();
        sendSystem(connection, "Deleted API key \"" + label + "\" (" +
                                   matches[0].substr(0, 10) + "...).");
        return true;
    }

    // -- commands this build does not have ---------------------------------

    if (verb == "/guild-menu" || verb == "/forcelocalplayerflags") {
        sendSystem(connection, verb + " is a client-side command and this client does not "
                                      "implement it.");
        return true;
    }

    if (verb == "/help") {
        sendSystem(connection, "Available commands:");
        sendSystem(connection, "/biome - Show the most populated biome");
        sendSystem(connection, "/level-from-string <name> - What level a bot named <name> rolls");
        sendSystem(connection, "/loadout-from-string <name> - The loadout that name rolls");
        sendSystem(connection, "/create-api-key [label] - Issue an API key tied to your account");
        sendSystem(connection, "/delete-api-key <key-or-prefix> - Revoke one of your API keys");
        sendSystem(connection, "Guild commands (up to " + std::to_string(kMaxGuildSize) +
                                   " members, persistent):");
        sendSystem(connection, "/guild-create <name> - Create a guild (5 chars, A-Z and 0-9)");
        sendSystem(connection, "/guild-invite <username> - Invite a player (leader only)");
        sendSystem(connection, "/guild-accept, /guild-decline - Respond to an invite");
        sendSystem(connection, "/guild-leave, /guild-kick <username> - Leave, or remove a member");
        sendSystem(connection, "/guild-info, /guild-list - Show your guild, or every guild");
        sendSystem(connection, "/g <message> - Send a message to your guild");
        sendSystem(connection, "Squads are not available on this server.");
        if (effectiveAdmin(session)) {
            sendSystem(connection, "Admin: /admin <command> (or /cmd <command>). Commands:");
            sendSystem(connection, "  save [player], list-players, list-sockets");
            sendSystem(connection, "  set_max_enemies <n>, set_bot_count <0-" +
                                       std::to_string(kMaxBots) + "|default>");
            sendSystem(connection, "  spawn <mob> <rarity> [x y] [amount] [stack|unstack]");
            sendSystem(connection, "  spawn_special_mobs, killall");
            sendSystem(connection, "  teleport|tp <player> <x> <y>, teleport_all|tpall <x> <y>");
            sendSystem(connection, "  teleport_bots|tpbots <x> <y>");
            sendSystem(connection, "  give <player> <petal> <rarity> [amount]");
            sendSystem(connection, "  corrupt <player> [on|off|toggle], set_skin <player> <flags>");
            sendSystem(connection, "  grant_admin <player>, revoke_admin <player>, list_admins");
            sendSystem(connection, "  mute <player>, unmute <player>");
            sendSystem(connection, "  generate_code <stars> [maxUses], list_codes, delete_code");
            sendSystem(connection, "  notification <type> <message>, clear_notifications");
            sendSystem(connection, "  guild_list, guild_info <name>, guild_force_join <g> <user>");
            sendSystem(connection, "  delete_guests, list_today_logins");
        }
        return true;
    }

    sendSystem(connection, "Unknown command. Try /help for the list.");
    return true;
}

// ---------------------------------------------------------------------------
// The admin console
// ---------------------------------------------------------------------------

void GameServer::runAdminCommand(Session& session, net::Connection& connection,
                                 const std::string& command) {
    const auto out = [&](const std::string& text) { sendSystem(connection, text); };

    const std::vector<std::string> words = splitWords(command);
    if (words.empty()) return;
    const std::string verb = lowerCase(words[0]);
    const std::string rest = argumentOf(trimmed(command));

    // The console is lent, not given: a grantee runs the world commands and
    // none of the ones that would let them extend the loan.
    if (!session.admin && !grantableCommand(verb)) {
        out("A temporary admin grant does not cover \"" + verb + "\".");
        return;
    }

    out("[ADMIN] " + session.username + " executed: " + command);

    // -- accounts and sessions ---------------------------------------------

    if (verb == "save") {
        if (words.size() >= 2) {
            CommandTarget target;
            if (!resolveCommandTarget(words[1], target) || target.session == nullptr) {
                out("Player \"" + words[1] + "\" not found, or is a bot with no account.");
                return;
            }
            persistPlayer(*target.session);
            out("Saved player " + target.name + ".");
            return;
        }
        int saved = 0;
        for (auto& entry : sessions_) {
            if (!entry.second.playing()) continue;
            persistPlayer(entry.second);
            ++saved;
        }
        // Straight to disk rather than waiting out the rate limiter: an
        // operator typing `save` is usually about to restart something.
        database_.save();
        out("Saved " + plural(saved, "player", "players") + ".");
        return;
    }

    if (verb == "list-players") {
        int listed = 0;
        for (auto& entry : sessions_) {
            const Session& other = entry.second;
            if (!other.playing()) continue;
            const PlayerProgress* progress = world_.tryGet<PlayerProgress>(other.entity);
            out("  " + other.username + " (" +
                (other.displayName.empty() ? other.username : other.displayName) + ") level " +
                std::to_string(progress != nullptr ? progress->level : 0));
            ++listed;
        }
        // Bots are players to every system in the world; hiding them here
        // would make the count disagree with what the console can teleport.
        for (const Bot& bot : bots_) {
            if (bot.entity == NULL_ENTITY || !world_.isAlive(bot.entity)) continue;
            const PlayerProgress* progress = world_.tryGet<PlayerProgress>(bot.entity);
            out("  " + (bot.name.empty() ? std::string("(unnamed)") : bot.name) + " [bot] level " +
                std::to_string(progress != nullptr ? progress->level : 0));
            ++listed;
        }
        if (listed == 0) out("No players online.");
        return;
    }

    if (verb == "list-sockets") {
        out("Sockets (" + std::to_string(sessions_.size()) + "):");
        for (auto& entry : sessions_) {
            const Session& other = entry.second;
            const char* stage = other.playing()      ? "playing"
                                : other.authenticated() ? "title screen"
                                                        : "connecting";
            out("  #" + std::to_string(entry.first) + " " +
                (other.username.empty() ? std::string("(anonymous)") : other.username) + " - " +
                stage);
        }
        return;
    }

    if (verb == "delete_guests") {
        // Only guests that never played: a guest who levelled up is a player
        // whose account happens to be named like a guest.
        std::vector<std::string> doomed;
        for (const std::string& username : database_.usernames()) {
            // The browser build's pattern: "User" followed by exactly eight
            // digits.
            if (username.size() != 12 || username.rfind("User", 0) != 0) continue;
            bool digits = true;
            for (std::size_t i = 4; i < username.size(); ++i) {
                if (!std::isdigit(static_cast<unsigned char>(username[i]))) digits = false;
            }
            if (!digits) continue;
            const Account* account = database_.findUser(username);
            if (account == nullptr) continue;
            const PlayerRecord* record = database_.findProgress(account->id);
            if (record != nullptr && !Database::isStarterProgress(*record)) continue;
            // Never delete an account that is logged in right now: the session
            // holding it would go on writing progress to a record that no
            // longer exists.
            if (sessionForUser(username) != nullptr) continue;
            doomed.push_back(username);
        }
        for (const std::string& username : doomed) database_.eraseUser(username);
        out("Deleted " + plural(static_cast<int>(doomed.size()), "guest account",
                                "guest accounts") +
            ".");
        return;
    }

    if (verb == "list_today_logins" || verb == "list_active") {
        const std::int64_t now = database_.nowMillis();
        const std::int64_t dayAgo = now - 24LL * 60 * 60 * 1000;
        std::vector<std::pair<std::string, std::int64_t>> active;
        for (const std::string& username : database_.usernames()) {
            const Account* account = database_.findUser(username);
            if (account == nullptr || account->lastActiveAtMillis < dayAgo) continue;
            active.emplace_back(account->username, account->lastActiveAtMillis);
        }
        if (active.empty()) {
            out("No accounts active in the last 24 hours.");
            return;
        }
        std::sort(active.begin(), active.end(),
                  [](const auto& a, const auto& b) { return a.second > b.second; });
        out("Accounts active in the last 24 hours (" + std::to_string(active.size()) + "):");
        for (const auto& [username, stamp] : active) {
            out("  " + username + " - " + agoLabel(now - stamp));
        }
        return;
    }

    // -- population knobs --------------------------------------------------

    if (verb == "set_max_enemies") {
        int count = 0;
        if (words.size() < 2 || !parseInteger(words[1], count) || count < 0) {
            out("Usage: set_max_enemies <count> - currently " +
                std::to_string(spawning_->mobCap) + ".");
            return;
        }
        spawning_->mobCap = count;
        // Lowering the cap does not cull: every spawn path tests it, so the
        // population drains through the ordinary despawn rather than a few
        // hundred mobs vanishing in front of whoever is fighting them.
        out("Max live mobs set to " + std::to_string(count) +
            " (existing mobs are left to despawn normally).");
        return;
    }

    if (verb == "set_bot_count") {
        if (words.size() >= 2 && lowerCase(words[1]) == "default") {
            botCountOverride_ = -1;
            out("Bot count override cleared (using the default formula).");
            return;
        }
        int requested = 0;
        if (words.size() < 2 || !parseInteger(words[1], requested) || requested < 0) {
            out("Usage: set_bot_count <0-" + std::to_string(kMaxBots) + "|default> - current "
                "override: " +
                (botCountOverride_ < 0 ? std::string("default")
                                       : std::to_string(botCountOverride_)));
            return;
        }
        // Over the cap CLAMPS and applies. The browser build reported the
        // clamp and then returned without applying anything, so
        // `set_bot_count 100` said it had capped at 50 and did nothing at all.
        const int applied = std::min(requested, kMaxBots);
        botCountOverride_ = applied;
        out(applied == requested
                ? "Bot count target set to " + std::to_string(applied) + "."
                : "Bot count target set to " + std::to_string(applied) + " (requested " +
                      std::to_string(requested) + ", capped at " + std::to_string(kMaxBots) + ").");
        return;
    }

    if (verb == "spawn_special_mobs") {
        spawning_->requestSpecialPass();
        out("Boss pass scheduled for the next tick (one ultra, a super per bare section, and a "
            "unique if one is due).");
        return;
    }

    if (verb == "killall" || verb == "kill_all" || verb == "clear_mobs") {
        int removed = 0;
        Query<MobTag> mobs{world_};
        mobs.without<Pet>();
        mobs.each([&](Entity entity, MobTag&) {
            commands_.destroy(entity);
            ++removed;
        });
        out("Killed " + plural(removed, "mob", "mobs") + " (pets left intact).");
        return;
    }

    if (verb == "spawn") {
        // Grammar, everything after <mob> <rarity> optional:
        //   spawn <mob> <rarity>                          -> 1 on you
        //   spawn <mob> <rarity> <amount> [stack|unstack] -> N on you
        //   spawn <mob> <rarity> <x> <y>                  -> 1 at (x,y)
        //   spawn <mob> <rarity> <x> <y> <amount> [stack] -> N at (x,y)
        const auto isStackWord = [](const std::string& s) {
            const std::string k = lowerCase(s);
            return k == "stack" || k == "stacked";
        };
        const auto isUnstackWord = [](const std::string& s) {
            const std::string k = lowerCase(s);
            return k == "unstack" || k == "unstacked" || k == "nostack";
        };
        const auto isStackFlag = [&](const std::string& s) {
            return isStackWord(s) || isUnstackWord(s);
        };

        if (words.size() < 3) {
            out("Usage: spawn <mob> <rarity> [x y] [amount] [stack|unstack]");
            out("  No x/y spawns on you. amount defaults to 1 (max 500); stack piles them on");
            out("  one spot, and the default spreads them via mob collision.");
            out("  Valid rarities: " + rarityList());
            return;
        }

        const std::uint16_t mobIndex = content().mobIndex(words[1]);
        if (mobIndex == kInvalidIndex) {
            out("No mob type named \"" + words[1] + "\".");
            return;
        }
        Rarity rarity = Rarity::Common;
        if (!parseRarityStrict(words[2], rarity)) {
            out("Invalid rarity \"" + words[2] + "\". Valid rarities: " + rarityList());
            return;
        }

        // Coordinates are present only when BOTH slots 3 and 4 parse as
        // numbers. `spawn bee rare 10 stack` has a stack word in slot 4, so
        // slot 3 there is an amount, not an x.
        double x = 0;
        double y = 0;
        bool hasCoords = false;
        std::size_t amountAt = 3;
        if (words.size() >= 5 && !isStackFlag(words[4]) && parseNumber(words[3], x) &&
            parseNumber(words[4], y)) {
            if (!saneCoordinate(x) || !saneCoordinate(y)) {
                out("Coordinates out of range: (" + words[3] + ", " + words[4] +
                    "). The map is 0 to " + std::to_string(static_cast<long>(kWorldSize)) + ".");
                return;
            }
            hasCoords = true;
            amountAt = 5;
        }

        int count = 1;
        bool stack = false;
        std::size_t stackAt = amountAt + 1;
        if (amountAt < words.size() && !isStackFlag(words[amountAt])) {
            if (!parseInteger(words[amountAt], count) || count < 1) {
                out("Invalid amount \"" + words[amountAt] +
                    "\". Amount must be a positive whole number.");
                return;
            }
        } else {
            stackAt = amountAt;
        }
        constexpr int kMaxSpawnBatch = 500;
        if (count > kMaxSpawnBatch) {
            out("Amount capped at " + std::to_string(kMaxSpawnBatch) + ".");
            count = kMaxSpawnBatch;
        }
        if (stackAt < words.size()) {
            if (isStackWord(words[stackAt])) {
                stack = true;
            } else if (!isUnstackWord(words[stackAt])) {
                out("Unknown option \"" + words[stackAt] + "\". Expected \"stack\" or \"unstack\".");
                return;
            }
        }

        // With no explicit coordinates the mobs land on whoever ran the
        // command, and on a random legal point when that player has no body --
        // a console command run from the title screen still has to put the mob
        // somewhere the world will accept.
        std::string where = " at (" + words[3] + ", " + words[4] + ")";
        bool placed = hasCoords;
        if (!placed && session.playing() && world_.isAlive(session.entity)) {
            if (const Transform* transform = world_.tryGet<Transform>(session.entity)) {
                x = transform->position.x;
                y = transform->position.y;
                where = " at your location";
                placed = true;
            }
        }
        if (!placed) {
            const Vec2 point = pickBotSpawn();
            x = point.x;
            y = point.y;
            where = " at a random location";
        }

        int spawned = 0;
        for (int i = 0; i < count; ++i) {
            Vec2 at{x, y};
            if (!stack && count > 1) {
                // A ring rather than a pile: spawnMob pushes a point out of the
                // terrain but does nothing about mobs standing on each other,
                // so unstacked has to mean actually apart.
                const double angle = rng_.angle();
                const double radius = rng_.range(0.0, 40.0 + 8.0 * static_cast<double>(i));
                at = {x + std::cos(angle) * radius, y + std::sin(angle) * radius};
            }
            if (spawning_->spawnMob(world_, *terrain_, content(), mobIndex, rarity, at,
                                    monotonicMillis(), rng_) != NULL_ENTITY) {
                ++spawned;
            }
        }
        out("Spawned " + std::to_string(spawned) + "x " + rarityName(rarity) + " " + words[1] +
            where + (count > 1 ? (stack ? ", stacked" : ", unstacked") : "") +
            (spawned < count ? " (" + std::to_string(count - spawned) +
                                   " refused - the mob cap or the terrain)"
                             : ""));
        return;
    }

    // -- teleports ---------------------------------------------------------

    if (verb == "teleport" || verb == "tp") {
        double x = 0;
        double y = 0;
        if (words.size() != 4 || !parseNumber(words[2], x) || !parseNumber(words[3], y)) {
            out("Usage: teleport <player> <x> <y>  (tp works too)");
            return;
        }
        if (!saneCoordinate(x) || !saneCoordinate(y)) {
            out("Coordinates out of range. The map is 0 to " +
                std::to_string(static_cast<long>(kWorldSize)) + " on each axis.");
            return;
        }
        CommandTarget target;
        if (!resolveCommandTarget(words[1], target)) {
            out("Player \"" + words[1] + "\" not found. Use list-players.");
            return;
        }
        teleportEntity(target.entity, {x, y});
        out("Teleported " + target.name + " to (" + words[2] + ", " + words[3] + ").");
        return;
    }

    if (verb == "teleport_all" || verb == "tpall" || verb == "teleport_bots" ||
        verb == "tpbots") {
        const bool botsOnly = verb == "teleport_bots" || verb == "tpbots";
        double x = 0;
        double y = 0;
        if (words.size() != 3 || !parseNumber(words[1], x) || !parseNumber(words[2], y)) {
            out("Usage: " + verb + " <x> <y>");
            return;
        }
        if (!saneCoordinate(x) || !saneCoordinate(y)) {
            out("Coordinates out of range. The map is 0 to " +
                std::to_string(static_cast<long>(kWorldSize)) + " on each axis.");
            return;
        }
        int movedBots = 0;
        for (const Bot& bot : bots_) {
            if (bot.entity == NULL_ENTITY || !world_.isAlive(bot.entity)) continue;
            teleportEntity(bot.entity, {x, y});
            ++movedBots;
        }
        if (botsOnly) {
            out("Teleported " + plural(movedBots, "bot", "bots") + " to (" + words[1] + ", " +
                words[2] + ").");
            return;
        }
        int moved = 0;
        for (auto& entry : sessions_) {
            if (!entry.second.playing()) continue;
            teleportEntity(entry.second.entity, {x, y});
            ++moved;
        }
        out("Teleported " + plural(moved, "player", "players") + " and " +
            plural(movedBots, "bot", "bots") + " to (" + words[1] + ", " + words[2] + ").");
        return;
    }

    // -- player state ------------------------------------------------------

    if (verb == "corrupt") {
        if (words.size() < 2 || words.size() > 3) {
            out("Usage: corrupt <player> [on|off|toggle]  (default: toggle)");
            return;
        }
        const std::string mode = words.size() == 3 ? lowerCase(words[2]) : "toggle";
        if (mode != "on" && mode != "off" && mode != "toggle") {
            out("Unknown mode \"" + words[2] + "\". Use on, off or toggle.");
            return;
        }
        CommandTarget target;
        if (!resolveCommandTarget(words[1], target)) {
            out("Player \"" + words[1] + "\" not found. Use list-players.");
            return;
        }
        PlayerVisuals* visuals = world_.tryGet<PlayerVisuals>(target.entity);
        if (visuals == nullptr) {
            out(target.name + " has no body to corrupt.");
            return;
        }
        // Setting the flag is the whole operation: combat resolves corruption
        // on the live flower every hit, and replication folds it into the face
        // flags, so a ring strung before this still turns hostile.
        visuals->corrupted = mode == "toggle" ? !visuals->corrupted : mode == "on";
        out((visuals->corrupted ? "Corrupted " : "Cleansed ") + target.name + ".");
        return;
    }

    if (verb == "set_skin") {
        int flags = 0;
        if (words.size() != 3 ||
            (lowerCase(words[2]) != "none" && (!parseInteger(words[2], flags) || flags < 0))) {
            out("Usage: set_skin <player> <renderFlags|none>");
            return;
        }
        if (lowerCase(words[2]) == "none") flags = 0;
        CommandTarget target;
        if (!resolveCommandTarget(words[1], target) || target.session == nullptr) {
            out("Player \"" + words[1] + "\" not found, or is a bot with no account.");
            return;
        }
        if (PlayerVisuals* visuals = world_.tryGet<PlayerVisuals>(target.entity)) {
            visuals->renderFlags = static_cast<std::uint32_t>(flags);
        }
        // Persisted immediately: a skin is account content, and waiting for
        // the periodic save would lose it to a restart.
        database_.progress(target.session->userId).renderFlags = static_cast<std::uint32_t>(flags);
        database_.markDirty();
        out("Set " + target.name + "'s renderFlags to " + std::to_string(flags) +
            (flags == 0 ? " (default flower)." : "."));
        return;
    }

    if (verb == "give") {
        if (words.size() < 4 || words.size() > 5) {
            out("Usage: give <player> <petal> <rarity> [amount]");
            out("  Works for online players and, by username, for offline accounts.");
            out("  Valid rarities: " + rarityList());
            return;
        }
        int amount = 1;
        if (words.size() == 5 && (!parseInteger(words[4], amount) || amount < 1)) {
            out("Invalid amount \"" + words[4] + "\". Amount must be a positive whole number.");
            return;
        }
        Rarity rarity = Rarity::Common;
        if (!parseRarityStrict(words[3], rarity)) {
            out("Invalid rarity \"" + words[3] + "\". Valid rarities: " + rarityList());
            return;
        }
        const std::uint16_t petalIndex = content().petalIndex(lowerCase(words[2]));
        if (petalIndex == kInvalidIndex) {
            out("No petal named \"" + words[2] + "\".");
            return;
        }

        // Online by account name, otherwise straight into the persisted
        // account: a give that only worked for people currently logged in is
        // half a command, and the live inventory is rebuilt from the record on
        // the next connection anyway.
        CommandTarget target;
        const bool online = resolveCommandTarget(words[1], target) && target.session != nullptr;
        const std::string userId =
            online ? target.session->userId
                   : [&] {
                         const Account* account = database_.findUser(words[1]);
                         return account != nullptr ? account->id : std::string();
                     }();
        if (userId.empty()) {
            out("Player \"" + words[1] + "\" not found - no online player and no account by that "
                "name.");
            return;
        }

        PlayerRecord& record = database_.progress(userId);
        record.addItem(rarity, "petal_" + content().petal(petalIndex).id, amount);
        database_.markDirty();
        if (online) {
            if (net::Connection* peer = listener_.find(target.session->connection)) {
                sendProfile(*target.session, *peer);
            }
        }
        out("Gave " + std::to_string(amount) + "x " + rarityName(rarity) + " " +
            content().petal(petalIndex).id + " to " +
            (online ? target.name : database_.canonicalUsername(words[1])) +
            (online ? "." : " (offline)."));
        return;
    }

    // -- moderation --------------------------------------------------------

    if (verb == "grant_admin" || verb == "revoke_admin") {
        const bool granting = verb == "grant_admin";
        if (words.size() != 2) {
            out("Usage: " + verb + " <player>");
            return;
        }
        CommandTarget target;
        if (!resolveCommandTarget(words[1], target) || target.session == nullptr) {
            out("Player \"" + words[1] + "\" not found, or is a bot with no account.");
            return;
        }
        net::Connection* peer = listener_.find(target.session->connection);
        if (granting) {
            if (target.session->admin) {
                out(target.name + " is already a full admin.");
                return;
            }
            if (tempAdmins_.count(target.session->connection) != 0) {
                out(target.name + " already has a temporary admin grant.");
                return;
            }
            tempAdmins_[target.session->connection] = {
                session.username, static_cast<double>(database_.nowMillis())};
            if (peer != nullptr) {
                // Resent so the grantee's own client learns it is admin and
                // stops hiding the /admin rows in its command autocomplete.
                sendSkinCatalog(*target.session, *peer);
                sendSystem(*peer, "You have been granted admin commands until you respawn. Use "
                                  "/admin <command> or /help.");
            }
            out("Granted temporary admin to " + target.name + " until they respawn.");
            return;
        }
        if (tempAdmins_.count(target.session->connection) == 0) {
            out(target.name + " has no temporary admin grant.");
            return;
        }
        revokeTempAdmin(target.session->connection);
        if (peer != nullptr) sendSystem(*peer, "Your temporary admin access has been revoked.");
        out("Revoked temporary admin from " + target.name + ".");
        return;
    }

    if (verb == "list_admins") {
        // Temporary grants only. Permanent admins are a database flag, not a
        // thing with a lifetime, and listing them here would read as if they
        // were about to expire.
        if (tempAdmins_.empty()) {
            out("No temporary admin grants are active.");
            return;
        }
        out("Temporary admins (" + std::to_string(tempAdmins_.size()) + "):");
        const double now = static_cast<double>(database_.nowMillis());
        for (const auto& [id, grant] : tempAdmins_) {
            const Session* holder = sessionFor(id);
            const std::string name = holder != nullptr ? holder->username : "(disconnected)";
            out("  " + name + " - granted by " + grant.grantedBy + ", " +
                std::to_string(static_cast<long>((now - grant.grantedAtMillis) / 1000)) +
                "s ago");
        }
        return;
    }

    if (verb == "mute" || verb == "unmute") {
        const bool muting = verb == "mute";
        if (words.size() != 2) {
            out("Usage: " + verb + " <player>");
            return;
        }
        // Straight to the account, so an offline player can be muted too: the
        // flag is persisted and outlives the session.
        Account* account = database_.findUser(words[1]);
        if (account == nullptr) {
            CommandTarget target;
            if (resolveCommandTarget(words[1], target) && target.session != nullptr) {
                account = database_.findUser(target.session->username);
            }
        }
        if (account == nullptr) {
            out("No account named \"" + words[1] +
                "\" exists (bots have no account and cannot chat).");
            return;
        }
        // Muting a full admin is refused, so a temporary grantee cannot
        // silence the admin who lent them the console.
        if (muting && account->admin) {
            out(account->username + " is a full admin and cannot be muted.");
            return;
        }
        if (account->muted == muting) {
            out(account->username + " is already " + (muting ? "muted." : "not muted."));
            return;
        }
        account->muted = muting;
        account->mutedAtMillis = muting ? database_.nowMillis() : 0;
        account->mutedBy = muting ? session.username : std::string();
        database_.markDirty();

        Session* holder = sessionForUser(account->username);
        if (holder != nullptr) {
            if (net::Connection* peer = listener_.find(holder->connection)) {
                sendSystem(*peer, muting ? "You have been muted by an admin and can no longer "
                                           "send chat messages."
                                         : "You have been unmuted and can send chat messages "
                                           "again.");
            }
        }
        out(std::string(muting ? "Muted " : "Unmuted ") + account->username +
            (holder != nullptr ? "." : " (offline)."));
        return;
    }

    // -- star codes --------------------------------------------------------

    if (verb == "generate_code" || verb == "gen_code") {
        int stars = 0;
        if (words.size() < 2 || !parseInteger(words[1], stars) || stars <= 0) {
            out("Usage: generate_code <stars> [maxUses]");
            out("  maxUses defaults to 1; pass 0 for unlimited.");
            return;
        }
        int maxUses = 1;
        if (words.size() >= 3 && (!parseInteger(words[2], maxUses) || maxUses < 0)) {
            out("Invalid maxUses \"" + words[2] + "\". Pass a whole number, or 0 for unlimited.");
            return;
        }

        Json& codes = database_.rawTable("codes");
        Rng codeRng(static_cast<std::uint64_t>(database_.nowMillis()) * 0x9E3779B97F4A7C15ull ^
                    static_cast<std::uint64_t>(codes.keys().size()));
        std::string code;
        for (int attempt = 0; attempt < 100; ++attempt) {
            code = mintCode(codeRng);
            if (!codes.contains(code)) break;
            code.clear();
        }
        if (code.empty()) {
            out("Failed to mint a unique code after 100 attempts.");
            return;
        }

        Json entry = Json::object();
        entry["code"] = code;
        entry["stars"] = stars;
        // Absent rather than zero for unlimited, which is the shape the
        // browser build writes and handleRedeemCode already reads: it treats a
        // maxUses of 0 as no limit, and an absent key reads as 0.
        if (maxUses > 0) entry["maxUses"] = maxUses;
        entry["uses"] = 0;
        entry["usedBy"] = Json::array();
        entry["createdBy"] = session.username;
        entry["createdAt"] = static_cast<double>(database_.nowMillis());
        codes[code] = std::move(entry);
        database_.markDirty();

        out("[CODE GENERATED] " + code);
        out("  Stars: " + std::to_string(stars));
        out("  Max uses: " + (maxUses > 0 ? std::to_string(maxUses) : std::string("unlimited")));
        out("  Players redeem it in the shop.");
        return;
    }

    if (verb == "list_codes") {
        const Json& codes = database_.storedTable("codes");
        if (!codes.isObject() || codes.keys().empty()) {
            out("No codes have been generated.");
            return;
        }
        out("Generated codes (" + std::to_string(codes.keys().size()) + "):");
        for (const std::string& code : codes.keys()) {
            const Json& entry = codes[code];
            const int maxUses = entry["maxUses"].asInt(0);
            out("  " + code + " - " + std::to_string(entry["stars"].asInt(0)) + " stars, " +
                std::to_string(entry["uses"].asInt(0)) +
                (maxUses > 0 ? "/" + std::to_string(maxUses) : std::string(" (unlimited)")) +
                " used, by " + entry["createdBy"].asString("unknown"));
        }
        return;
    }

    if (verb == "delete_code") {
        if (words.size() != 2) {
            out("Usage: delete_code <code>");
            return;
        }
        std::string code = words[1];
        for (char& c : code) c = static_cast<char>(std::toupper(static_cast<unsigned char>(c)));
        Json& codes = database_.rawTable("codes");
        if (!codes.contains(code)) {
            out("Code " + code + " not found.");
            return;
        }
        codes.erase(code);
        database_.markDirty();
        out("Code " + code + " deleted.");
        return;
    }

    // -- notifications -----------------------------------------------------

    if (verb == "notification" || verb == "notify") {
        const std::string type = words.size() >= 2 ? lowerCase(words[1]) : std::string();
        const std::string text = words.size() >= 3 ? joined(words, 2) : std::string();
        if (text.empty() || !validNotificationType(type)) {
            out("Usage: " + verb + " <type> <message>");
            out("  Valid types: super_craft, unique_craft, apex_craft, star_code");
            return;
        }
        // rawArrayTable, never rawTable: this is the one unmodelled table the
        // browser stores as an ARRAY, and coercing it would replace the whole
        // feed with an empty object.
        Json& feed = database_.rawArrayTable("notifications");
        const std::int64_t now = database_.nowMillis();
        Json entry = Json::object();
        entry["id"] = std::to_string(now) + "-" + std::to_string(feed.size());
        entry["type"] = type;
        entry["message"] = text;
        entry["timestamp"] = static_cast<double>(now);
        feed.push(std::move(entry));
        database_.markDirty();
        out("Notification created: " + text);
        return;
    }

    if (verb == "clear_notifications" || verb == "clear_notifs") {
        Json& feed = database_.rawArrayTable("notifications");
        const std::size_t count = feed.size();
        feed = Json::array();
        database_.markDirty();
        out("Cleared " + plural(static_cast<int>(count), "notification", "notifications") + ".");
        return;
    }

    // -- guilds ------------------------------------------------------------

    if (verb == "guild_list" || verb == "list_guilds") {
        const Json& guilds = database_.storedTable("guilds");
        if (!guilds.isObject() || guilds.keys().empty()) {
            out("No guilds exist.");
            return;
        }
        out("Guilds (" + std::to_string(guilds.keys().size()) + "):");
        for (const std::string& key : guilds.keys()) {
            const Json& guild = guilds[key];
            out("  \"" + key + "\" - " + std::to_string(guild["memberUsernames"].size()) + "/" +
                std::to_string(kMaxGuildSize) + " - leader @" +
                guild["leaderUsername"].asString());
        }
        return;
    }

    if (verb == "guild_info") {
        const std::string name = normalizeGuildName(rest);
        const Json& guilds = database_.storedTable("guilds");
        if (name.empty() || !guilds.isObject() || !guilds.contains(name)) {
            out(name.empty() ? "Usage: guild_info <guild name>"
                             : "Guild \"" + name + "\" not found.");
            return;
        }
        const Json& guild = guilds[name];
        const Json& members = guild["memberUsernames"];
        out("\"" + name + "\" - leader @" + guild["leaderUsername"].asString() + " - " +
            std::to_string(members.size()) + "/" + std::to_string(kMaxGuildSize));
        for (std::size_t i = 0; i < members.size(); ++i) {
            const std::string member = members[i].asString();
            out("  " + member + (sessionForUser(member) != nullptr ? " (online)" : ""));
        }
        return;
    }

    if (verb == "guild_force_join" || verb == "guild_force") {
        // The guild name may contain spaces in the browser build, so the LAST
        // token is the username and everything between is the name.
        if (words.size() < 3) {
            out("Usage: guild_force_join <guild name> <username>");
            return;
        }
        const std::string targetUser = words.back();
        std::string guildName;
        for (std::size_t i = 1; i + 1 < words.size(); ++i) {
            if (!guildName.empty()) guildName += ' ';
            guildName += words[i];
        }
        guildName = normalizeGuildName(guildName);

        Json& guilds = database_.rawTable("guilds");
        if (!guilds.contains(guildName)) {
            out("Guild \"" + guildName + "\" not found.");
            return;
        }
        const std::string canonical = database_.canonicalUsername(targetUser);
        if (canonical.empty()) {
            out("No account named \"" + targetUser + "\" exists.");
            return;
        }
        if (guilds[guildName]["memberUsernames"].size() >= kMaxGuildSize) {
            out("Guild \"" + guildName + "\" is full.");
            return;
        }

        // Leaving the previous guild is part of joining: membership is stored
        // on the guild, so a player left in two member arrays IS in two guilds
        // and guildNameForUser would answer with whichever it walked first.
        const std::string previous = guildNameForUser(canonical);
        if (previous == guildName) {
            out(canonical + " is already in \"" + guildName + "\".");
            return;
        }
        if (!previous.empty()) {
            Json& old = guilds[previous];
            const int index = guildMemberIndex(old, canonical);
            if (index >= 0) {
                Json kept = Json::array();
                const Json& members = old["memberUsernames"];
                for (std::size_t i = 0; i < members.size(); ++i) {
                    if (static_cast<int>(i) != index) kept.push(members[i]);
                }
                old["memberUsernames"] = std::move(kept);
            }
            broadcastGuildRoster(guilds[previous]);
        }
        guilds[guildName]["memberUsernames"].push(Json(canonical));
        database_.markDirty();

        if (net::Connection* peer = connectionForUser(canonical)) {
            sendSystem(*peer, "You were added to guild \"" + guildName + "\" by an admin.");
        }
        broadcastGuildRoster(guilds[guildName]);
        out("Force-joined " + canonical + " into guild \"" + guildName + "\".");
        return;
    }

    // -- present in the client's table, absent from this build --------------

    static const std::array<const char*, 8> kUnsupported = {
        "restart", "backup_db", "db_backup", "update", "change-maze", "change_maze", "simtick",
        "remove_petal",
    };
    for (const char* name : kUnsupported) {
        if (verb == name) {
            out("\"" + verb +
                "\" is not available on this server. The client lists the browser build's whole "
                "command table; this one has no counterpart for it.");
            return;
        }
    }

    out("Unknown command \"" + verb + "\". Try /help for the list.");
}

} // namespace flr
