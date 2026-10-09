// The admin database editor: the server half of the panel that `/admin db`
// opens.
//
// Who may use it is the DATABASE flag, `session.admin`, and nothing else. The
// console's temporary grants are lent for one life (see grant_admin), and this
// panel reaches further than the console does -- it resets passwords and
// rewrites any record -- so a loan does not extend to it. Every op
// re-checks it; nothing is trusted from the panel being open. The flag is not
// enough on its own, either: `/admin db` asks for a key that only the server's
// machine can tell you (server/admin_db_key.h), and every op checks that THIS
// connection, signed in as THIS account, typed it.
//
// Two kinds of document can be edited:
//
//  * An ACCOUNT: its row in `users` and its record in `players`, side by side
//    as {"account": ..., "progress": ...}. An edit is applied to the row's JSON
//    and the row is then re-read through the database's own parse, so what is
//    left in memory is exactly what the next load would see. The identity
//    fields -- id, username, password -- are not editable: the first two key
//    the indices the whole database is looked up through, and a password is
//    set through its own action, which hashes it and revokes the sessions.
//    Nor is `admin`, for anyone, on any account: who holds the keys to the
//    server is a security decision, and one compromised or careless admin
//    session must not be able to mint more admins -- or lock the others out --
//    from a panel. It is set on the server's own machine, not from inside the
//    game.
//
//  * One of the unmodelled top-level TABLES (codes, guilds, notifications,
//    customSkins, ...), edited as the raw JSON it already is. Every handler
//    that uses those reads the table live, so an edit takes effect at once.
//
// A player who is online is the awkward case, because the live body -- not the
// record -- is the authority for XP and stars between saves (see
// applyAccountToEntity). So an edit FLUSHES the body into the record first,
// edits the record, then pushes the record back onto the body and re-sends the
// profile: without the flush the next autosave would write the body's figure
// back over the edit, and without the push the edit would not show until the
// player respawned.

#include "server/admin_db.h"

#include <algorithm>
#include <cctype>
#include <cstdio>
#include <unordered_set>
#include <utility>

#include "server/game_server.h"
#include "server/text.h"
#include "shared/game/constants.h"

namespace flix {

// ---------------------------------------------------------------------------
// Path edits
// ---------------------------------------------------------------------------

namespace admin_db {

namespace {

/// An array step: a plain decimal, no sign and no leading zero, so "01" and
/// "1" cannot both name the same element.
bool parseIndex(const std::string& step, std::size_t& out) {
    if (step.empty() || step.size() > 9) return false;
    if (step.size() > 1 && step[0] == '0') return false;
    for (const char c : step) {
        if (!std::isdigit(static_cast<unsigned char>(c))) return false;
    }
    out = static_cast<std::size_t>(std::stoul(step));
    return true;
}

/// The first `steps` steps of `path`, walked mutably. Never inserts: the
/// inserting operator[] is only reached for a key that is already there.
Json* walk(Json& root, const net::AdminDbPath& path, std::size_t steps, std::string& error) {
    Json* node = &root;
    for (std::size_t i = 0; i < steps; ++i) {
        const std::string& step = path[i];
        if (node->isObject() && node->contains(step)) {
            node = &(*node)[step];
        } else if (node->isArray()) {
            std::size_t index = 0;
            if (!parseIndex(step, index) || index >= node->size()) {
                error = "There is no element " + step + " in " +
                        describePath(net::AdminDbPath(path.begin(), path.begin() + i)) + ".";
                return nullptr;
            }
            node = &node->items()[index];
        } else {
            error = "\"" + describePath(net::AdminDbPath(path.begin(), path.begin() + i + 1)) +
                    "\" does not exist any more.";
            return nullptr;
        }
    }
    return node;
}

} // namespace

const Json* nodeAt(const Json& root, const net::AdminDbPath& path) {
    const Json* node = &root;
    for (const std::string& step : path) {
        if (node->isObject()) {
            if (!node->contains(step)) return nullptr;
            node = &(*node)[step];
        } else if (node->isArray()) {
            std::size_t index = 0;
            if (!parseIndex(step, index) || index >= node->size()) return nullptr;
            node = &(*node)[index];
        } else {
            return nullptr;
        }
    }
    return node;
}

bool setAt(Json& root, const net::AdminDbPath& path, Json value, std::string& error) {
    if (path.empty()) {
        error = "Pick a field to change.";
        return false;
    }
    Json* parent = walk(root, path, path.size() - 1, error);
    if (parent == nullptr) return false;
    const std::string& last = path.back();
    if (parent->isObject()) {
        if (last.empty()) {
            error = "A field needs a name.";
            return false;
        }
        (*parent)[last] = std::move(value);
        return true;
    }
    if (parent->isArray()) {
        if (last == "-") {
            parent->push(std::move(value));
            return true;
        }
        std::size_t index = 0;
        if (!parseIndex(last, index) || index >= parent->size()) {
            error = "There is no element " + last + " to replace.";
            return false;
        }
        parent->items()[index] = std::move(value);
        return true;
    }
    error = "\"" + describePath(net::AdminDbPath(path.begin(), path.end() - 1)) +
            "\" holds a single value, not fields.";
    return false;
}

bool removeAt(Json& root, const net::AdminDbPath& path, std::string& error) {
    if (path.empty()) {
        error = "Pick a field to delete.";
        return false;
    }
    Json* parent = walk(root, path, path.size() - 1, error);
    if (parent == nullptr) return false;
    const std::string& last = path.back();
    if (parent->isObject() && parent->contains(last)) {
        parent->erase(last);
        return true;
    }
    std::size_t index = 0;
    if (parent->isArray() && parseIndex(last, index) && index < parent->size()) {
        parent->items().erase(parent->items().begin() + static_cast<std::ptrdiff_t>(index));
        return true;
    }
    error = "\"" + describePath(path) + "\" does not exist any more.";
    return false;
}

std::string describePath(const net::AdminDbPath& path) {
    std::string out;
    for (const std::string& step : path) {
        if (!out.empty()) out += '.';
        out += step;
    }
    return out.empty() ? std::string("(root)") : out;
}

} // namespace admin_db

// ---------------------------------------------------------------------------
// The handlers
// ---------------------------------------------------------------------------

namespace {

using net::AdminDbOp;
using net::AdminDbPath;
using net::AdminDbReply;
using net::AdminDbScope;

/// A value as the log prints it: compact, and cut short. The log is for
/// finding out who changed what, not for restoring it -- the backups are.
std::string logValue(const Json& value) {
    std::string text = value.dump();
    constexpr std::size_t kMax = 160;
    if (text.size() > kMax) text = text.substr(0, kMax) + "...";
    return text;
}

ByteWriter beginReply(AdminDbReply kind) {
    ByteWriter w;
    w.u8(static_cast<std::uint8_t>(net::ServerMessage::AdminDb));
    w.u8(static_cast<std::uint8_t>(kind));
    return w;
}

/// The account row as the editor shows it: everything but the password hash,
/// which is no use to read and is set through its own action.
Json accountDocument(const Account& account, const PlayerRecord* record) {
    Json shown = accountRecordJson(account);
    shown.erase("password");
    Json doc = Json::object();
    doc["account"] = std::move(shown);
    doc["progress"] = record != nullptr ? playerRecordJson(*record) : Json::object();
    return doc;
}

} // namespace

void GameServer::sendAdminDbOpen(net::Connection& connection, const std::string& username) {
    ByteWriter w = beginReply(AdminDbReply::Open);
    w.str(username);
    connection.send(w);
}

void GameServer::sendAdminDbResult(net::Connection& connection, bool ok, net::AdminDbScope scope,
                                   const std::string& key, bool gone,
                                   const std::string& message) {
    ByteWriter w = beginReply(AdminDbReply::Result);
    w.boolean(ok);
    w.u8(static_cast<std::uint8_t>(scope));
    w.str(key);
    w.boolean(gone);
    w.str(message);
    connection.send(w);
}

std::uint8_t GameServer::adminDbAccountFlags(const Account& account) const {
    std::uint8_t flags = 0;
    if (account.admin) flags |= net::AdminDbIsAdmin;
    if (account.muted) flags |= net::AdminDbMuted;
    for (const auto& entry : sessions_) {
        if (entry.second.authenticated() && entry.second.userId == account.id) {
            flags |= net::AdminDbOnline;
            break;
        }
    }
    return flags;
}

bool GameServer::sendAdminDbAccount(net::Connection& connection, const std::string& username,
                                    const net::AdminDbPath& path) {
    const Account* account = std::as_const(database_).findUser(username);
    if (account == nullptr) return false;
    // A player in the world is ahead of their record by whatever they have
    // earned since the last autosave. Flushed first, so the editor shows what
    // the player has rather than what they had half a minute ago.
    for (auto& entry : sessions_) {
        const Session& other = entry.second;
        if (other.playing() && other.userId == account->id) persistPlayer(other);
    }
    const Json doc = accountDocument(*account, database_.findProgress(account->id));
    const Json* node = admin_db::nodeAt(doc, path);
    if (node == nullptr) return false;

    ByteWriter w = beginReply(AdminDbReply::Node);
    w.u8(static_cast<std::uint8_t>(AdminDbScope::Account));
    w.str(account->username);
    net::writeAdminDbPath(w, path);
    w.u8(adminDbAccountFlags(*account));
    net::writeAdminDbNode(w, *node);
    connection.send(w);
    return true;
}

bool GameServer::sendAdminDbTable(net::Connection& connection, const std::string& table,
                                  const net::AdminDbPath& path) {
    const std::vector<std::string> names = database_.storedTableNames();
    if (std::find(names.begin(), names.end(), table) == names.end()) return false;
    const Json* node = admin_db::nodeAt(database_.storedTable(table), path);
    if (node == nullptr) return false;

    ByteWriter w = beginReply(AdminDbReply::Node);
    w.u8(static_cast<std::uint8_t>(AdminDbScope::Table));
    w.str(table);
    net::writeAdminDbPath(w, path);
    w.u8(0);
    net::writeAdminDbNode(w, *node);
    connection.send(w);
    return true;
}

void GameServer::handleAdminDb(Session& session, net::Connection& connection, ByteReader& reader) {
    // Not a word to anyone else, as `/admin` answers a stranger: an editor
    // that said "you are not allowed" would be confirming it exists.
    // The key, too: typed this connection, by the account signed in now.
    if (!session.authenticated() || !session.admin) return;
    if (session.adminDbUnlockedFor.empty() || session.adminDbUnlockedFor != session.userId) return;

    const auto op = static_cast<AdminDbOp>(reader.u8());
    switch (op) {
        case AdminDbOp::List: {
            const std::string search = reader.str();
            const std::uint32_t offset = reader.u32();
            if (!reader.ok()) return;
            adminDbList(connection, search, offset);
            return;
        }
        case AdminDbOp::Tables: {
            ByteWriter w = beginReply(AdminDbReply::Tables);
            const std::vector<std::string> names = database_.storedTableNames();
            w.u16(static_cast<std::uint16_t>(std::min<std::size_t>(names.size(), 0xFFFF)));
            for (std::size_t i = 0; i < names.size() && i < 0xFFFF; ++i) {
                const Json& table = database_.storedTable(names[i]);
                w.str(names[i]);
                w.boolean(table.isArray());
                w.u32(static_cast<std::uint32_t>(table.size()));
            }
            connection.send(w);
            return;
        }
        case AdminDbOp::Fetch: {
            const auto scope = static_cast<AdminDbScope>(reader.u8());
            const std::string key = reader.str();
            const AdminDbPath path = net::readAdminDbPath(reader);
            if (!reader.ok()) return;
            const bool sent = scope == AdminDbScope::Account
                                  ? sendAdminDbAccount(connection, key, path)
                                  : sendAdminDbTable(connection, key, path);
            if (!sent) {
                // The document, or the part of it that was asked for, went
                // away between the panel drawing it and asking for it.
                const bool gone = path.empty();
                const std::string what =
                    scope == AdminDbScope::Account ? "account" : "table";
                sendAdminDbResult(connection, false, scope, key, gone,
                                  gone ? "There is no " + what + " \"" + key + "\"."
                                       : "\"" + admin_db::describePath(path) +
                                             "\" no longer exists.");
            }
            return;
        }
        case AdminDbOp::Set:
        case AdminDbOp::Remove:
            adminDbEdit(session, connection, reader, op == AdminDbOp::Remove);
            return;
        case AdminDbOp::SetPassword:
        case AdminDbOp::SignOut:
            adminDbAccountAction(session, connection, op, reader);
            return;
    }
}

void GameServer::adminDbList(net::Connection& connection, const std::string& search,
                             std::uint32_t offset) {
    const std::string needle = lowerCase(trimmed(search));

    std::unordered_set<std::string> online;
    for (const auto& entry : sessions_) {
        if (entry.second.authenticated()) online.insert(entry.second.userId);
    }

    struct Row {
        const Account* account;
        bool exact;
        bool online;
    };
    std::vector<Row> rows;
    // Read through the CONST database: the mutable lookups drop each row's
    // cached save text (Database::Table), and a search across every account
    // would otherwise make the next autosave re-serialise all of them.
    const Database& db = database_;
    for (const std::string& name : db.usernames()) {
        const Account* account = db.findUser(name);
        if (account == nullptr) continue;
        const std::string lowered = lowerCase(account->username);
        if (!needle.empty() && lowered.find(needle) == std::string::npos) continue;
        rows.push_back({account, lowered == needle, online.count(account->id) != 0});
    }
    // The exact name first, then whoever is on now, then the most recently
    // active. The file is thousands of accounts deep and most are throwaway
    // registrations; the order puts the people an admin is looking for first.
    std::sort(rows.begin(), rows.end(), [](const Row& a, const Row& b) {
        if (a.exact != b.exact) return a.exact;
        if (a.online != b.online) return a.online;
        if (a.account->lastActiveAtMillis != b.account->lastActiveAtMillis) {
            return a.account->lastActiveAtMillis > b.account->lastActiveAtMillis;
        }
        return a.account->username < b.account->username;
    });

    const std::size_t total = rows.size();
    const std::size_t first = std::min<std::size_t>(offset, total);
    const std::size_t count = std::min<std::size_t>(net::kAdminDbPageSize, total - first);

    ByteWriter w = beginReply(AdminDbReply::Accounts);
    w.str(search);
    w.u32(static_cast<std::uint32_t>(first));
    w.u32(static_cast<std::uint32_t>(total));
    w.u16(static_cast<std::uint16_t>(count));
    for (std::size_t i = first; i < first + count; ++i) {
        const Account& account = *rows[i].account;
        const PlayerRecord* record = db.findProgress(account.id);
        w.str(account.username);
        w.u16(static_cast<std::uint16_t>(
            levelFromTotalXp(record != nullptr ? record->totalXp : 0.0).level));
        w.u8(adminDbAccountFlags(account));
    }
    connection.send(w);
}

void GameServer::adminDbEdit(Session& session, net::Connection& connection, ByteReader& reader,
                             bool remove) {
    const auto scope = static_cast<AdminDbScope>(reader.u8());
    const std::string key = reader.str();
    const AdminDbPath path = net::readAdminDbPath(reader);
    const std::string valueText = remove ? std::string() : reader.str();
    if (!reader.ok()) return;
    if (scope != AdminDbScope::Account && scope != AdminDbScope::Table) return;

    const auto refuse = [&](const std::string& why) {
        sendAdminDbResult(connection, false, scope, key, false, why);
    };

    Json value;
    if (!remove) {
        std::string error;
        if (!Json::parse(valueText, value, error)) {
            refuse("That is not valid JSON: " + error);
            return;
        }
    }
    const std::string where = admin_db::describePath(path);
    const std::string verb = remove ? "deleted" : "set";

    // -- a table -------------------------------------------------------------
    if (scope == AdminDbScope::Table) {
        const std::vector<std::string> names = database_.storedTableNames();
        if (std::find(names.begin(), names.end(), key) == names.end()) {
            sendAdminDbResult(connection, false, scope, key, true,
                              "There is no table \"" + key + "\".");
            return;
        }
        if (path.empty()) {
            refuse("A whole table cannot be replaced from here. Edit its entries.");
            return;
        }
        // The array-shaped table through the array accessor: the other one
        // coerces to an object and would replace the notification feed with {}.
        Json& table = database_.storedTable(key).isArray() ? database_.rawArrayTable(key)
                                                           : database_.rawTable(key);
        std::string error;
        const bool ok = remove ? admin_db::removeAt(table, path, error)
                               : admin_db::setAt(table, path, value, error);
        if (!ok) {
            refuse(error);
            return;
        }
        database_.markDirty();
        std::printf("[ADMIN-DB] %s %s %s.%s%s\n", session.username.c_str(), verb.c_str(),
                    key.c_str(), where.c_str(), remove ? "" : (" = " + logValue(value)).c_str());

        // The edited entry's parent, so the row and its siblings are current
        // -- an append or a delete renumbers an array's tail.
        sendAdminDbTable(connection, key, AdminDbPath(path.begin(), path.end() - 1));
        // A guild roster is pushed to its members whenever it changes; an edit
        // here is a change like any other.
        if (key == "guilds") {
            if (const Json* guild = admin_db::nodeAt(table, AdminDbPath{path.front()})) {
                if (guild->isObject()) broadcastGuildRoster(*guild);
            }
        }
        sendAdminDbResult(connection, true, scope, key, false,
                          (remove ? "Deleted " : "Saved ") + key + "." + where + ".");
        return;
    }

    // -- an account ----------------------------------------------------------
    Account* account = database_.findUser(key);
    if (account == nullptr) {
        sendAdminDbResult(connection, false, scope, key, true, "There is no account \"" + key + "\".");
        return;
    }
    const std::string username = account->username;
    const std::string userId = account->id;
    if (path.size() < 2 || (path[0] != "account" && path[0] != "progress")) {
        refuse("Pick a field inside the account or its progress.");
        return;
    }
    const AdminDbPath inner(path.begin() + 1, path.end());
    const bool accountRow = path[0] == "account";
    if (accountRow) {
        const std::string& field = inner.front();
        if (field == "password") {
            refuse("Use Set password: a password is stored hashed, never as typed.");
            return;
        }
        if (field == "id" || field == "username") {
            refuse("\"" + field + "\" is what the database files the account under; it cannot be "
                   "changed here.");
            return;
        }
        if (field == "admin") {
            refuse("The admin flag cannot be changed from the editor, for security.");
            return;
        }
    }

    for (auto& entry : sessions_) {
        const Session& other = entry.second;
        if (other.playing() && other.userId == userId) persistPlayer(other);
    }

    std::string error;
    Json before;
    Json after;
    if (accountRow) {
        Json row = accountRecordJson(*account);
        before = row;
        const bool ok = remove ? admin_db::removeAt(row, inner, error)
                               : admin_db::setAt(row, inner, value, error);
        if (!ok) {
            refuse(error);
            return;
        }
        Account updated = parseAccountRecord(row, username);
        // Whatever the JSON says now, these four stay what they were: the
        // checks above refused a path to them, and this is the belt to those
        // braces.
        updated.id = account->id;
        updated.username = account->username;
        updated.passwordHash = account->passwordHash;
        updated.admin = account->admin;
        *account = std::move(updated);
        after = accountRecordJson(*account);
    } else {
        PlayerRecord& record = database_.progress(userId);
        Json row = playerRecordJson(record);
        before = row;
        const bool ok = remove ? admin_db::removeAt(row, inner, error)
                               : admin_db::setAt(row, inner, value, error);
        if (!ok) {
            refuse(error);
            return;
        }
        record = parsePlayerRecord(row);
        after = playerRecordJson(record);
    }
    database_.markDirty();
    std::printf("[ADMIN-DB] %s %s %s:%s%s\n", session.username.c_str(), verb.c_str(),
                username.c_str(), where.c_str(), remove ? "" : (" = " + logValue(value)).c_str());

    adminDbRefreshLive(userId);
    sendAdminDbAccount(connection, username, {});

    // Saying what was STORED, not what was asked for. The parse a load runs
    // drops what it does not understand and derives what it can -- `tp` is
    // worked out from the level, `muted: "yes"` is not a true -- and an editor
    // that answered "saved" to those would be lying about the database.
    std::string message;
    bool stored = true;
    const Json* landed = admin_db::nodeAt(after, inner);
    const Json* was = admin_db::nodeAt(before, inner);
    if (before.dump() == after.dump()) {
        if (!remove && was != nullptr && was->dump() == value.dump()) {
            message = where + " already was " + logValue(value) + ".";
        } else {
            stored = false;
            message = remove ? "Not deleted: the server works " + where + " out for itself."
                             : "Not saved: the server works " + where +
                                   " out for itself, or does not accept " + logValue(value) +
                                   " there.";
        }
    } else if (remove) {
        message = landed == nullptr ? "Deleted " + where + " from " + username + "."
                                    : "Reset " + where + " on " + username + " to " +
                                          logValue(*landed) + ".";
    } else if (landed == nullptr) {
        // Defaults are left out of the file -- stars at 0, muted at false --
        // so a value set back to its default reads back as absent.
        message = "Saved " + where + " on " + username + " (stored as its default, so left out).";
    } else if (landed->dump() != value.dump()) {
        message = "Saved " + where + " on " + username + " as " + logValue(*landed) + ".";
    } else {
        message = "Saved " + where + " on " + username + ".";
    }
    sendAdminDbResult(connection, stored, scope, key, false, message);
}

void GameServer::adminDbRefreshLive(const std::string& userId) {
    for (auto& entry : sessions_) {
        Session& other = entry.second;
        if (!other.authenticated() || other.userId != userId) continue;
        net::Connection* peer = listener_.find(entry.first);

        if (other.playing()) {
            const PlayerRecord& record = database_.progress(userId);
            // A run in the ring plays on a scratch copy that carries the
            // account's XP and stars; without these the run's copy would put
            // the old figures back at the next save.
            if (other.arena) {
                other.arena->totalXp = record.totalXp;
                other.arena->stars = record.stars;
            }
            // XP is seeded onto a body once, when it is built, and is the
            // body's from then on -- so an edit has to be written onto it.
            // The record was flushed from the body before the edit, so this
            // loses nothing the player earned.
            const double trackXp = other.realm == Realm::Maze ? record.mazeTotalXp : record.totalXp;
            for (const Entity body : bodiesOf(other)) {
                if (body == NULL_ENTITY || !world_.isAlive(body)) continue;
                if (PlayerProgress* progress = world_.tryGet<PlayerProgress>(body)) {
                    progress->totalXp = trackXp;
                    progress->level = levelFromTotalXp(trackXp).level;
                }
            }
            applyAccountToSession(other);
        }
        if (peer != nullptr) sendProfile(other, *peer);
    }
}

int GameServer::adminDbSignOutConnections(const std::string& userId, const std::string& reason) {
    int signedOut = 0;
    for (auto& [id, other] : sessions_) {
        if (!other.authenticated() || other.userId != userId) continue;
        net::Connection* peer = listener_.find(id);
        // What replaceOtherSessions does on the way out: the squad is told
        // while the session still has a name, and the body is saved first.
        departSquad(other, nullptr, squadDisplayName(squadIdOf(other)));
        signOut(other);
        if (peer != nullptr) {
            // The answer a dead token gets, which the client already reads as
            // "back to the login form".
            sendAuthResult(*peer, net::AuthStatus::SessionExpired, "", "", reason);
        }
        ++signedOut;
    }
    return signedOut;
}

void GameServer::adminDbAccountAction(Session& session, net::Connection& connection,
                                      net::AdminDbOp op, ByteReader& reader) {
    const std::string key = reader.str();
    const std::string password = op == AdminDbOp::SetPassword ? reader.str() : std::string();
    if (!reader.ok()) return;
    const AdminDbScope scope = AdminDbScope::Account;

    const Account* account = std::as_const(database_).findUser(key);
    if (account == nullptr) {
        sendAdminDbResult(connection, false, scope, key, true, "There is no account \"" + key + "\".");
        return;
    }
    const std::string username = account->username;
    const std::string userId = account->id;
    const bool self = userId == session.userId;
    const auto refuse = [&](const std::string& why) {
        sendAdminDbResult(connection, false, scope, username, false, why);
    };

    if (op == AdminDbOp::SetPassword) {
        if (self) {
            refuse("Change your own password from Settings: it asks for the current one.");
            return;
        }
        std::string reason;
        if (!database_.setPassword(username, password, reason)) {
            refuse(reason);
            return;
        }
        // A reset is as often a recovery as a favour, so whoever was holding
        // the account goes: every saved login, and every live connection.
        const int revoked = database_.revokeSessionsForUser(username);
        const int kicked = adminDbSignOutConnections(userId, "Your password was changed by an admin.");
        database_.maybeSave(monotonicMillis());
        std::printf("[ADMIN-DB] %s set the password of %s\n", session.username.c_str(),
                    username.c_str());
        sendAdminDbAccount(connection, username, {});
        sendAdminDbResult(connection, true, scope, username, false,
                          "New password set for " + username + ". Signed out " +
                              std::to_string(kicked) + " connection(s) and " +
                              std::to_string(revoked) + " saved login(s).");
        return;
    }

    if (op == AdminDbOp::SignOut) {
        if (self) {
            refuse("Use Log Out in Settings to sign yourself out.");
            return;
        }
        const int revoked = database_.revokeSessionsForUser(username);
        const int kicked = adminDbSignOutConnections(userId, "An admin signed this account out.");
        database_.maybeSave(monotonicMillis());
        std::printf("[ADMIN-DB] %s signed out %s\n", session.username.c_str(), username.c_str());
        sendAdminDbAccount(connection, username, {});
        sendAdminDbResult(connection, true, scope, username, false,
                          "Signed out " + std::to_string(kicked) + " connection(s) and " +
                              std::to_string(revoked) + " saved login(s) of " + username + ".");
        return;
    }
}

} // namespace flix
