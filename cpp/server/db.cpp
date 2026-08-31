#include "server/db.h"

#include <algorithm>
#include <chrono>
#include <cstdio>
#include <cstring>
#include <sys/stat.h>
#include <unistd.h>

namespace flr {
namespace {

std::string toLower(std::string text) {
    for (char& c : text) {
        if (c >= 'A' && c <= 'Z') c = static_cast<char>(c - 'A' + 'a');
    }
    return text;
}

bool fileExists(const std::string& path) {
    struct stat info {};
    return ::stat(path.c_str(), &info) == 0;
}

bool readWholeFile(const std::string& path, std::string& out, std::string& errorOut) {
    std::FILE* f = std::fopen(path.c_str(), "rb");
    if (!f) { errorOut = path + ": cannot open for reading"; return false; }
    out.clear();
    char chunk[64 * 1024];
    while (std::size_t got = std::fread(chunk, 1, sizeof(chunk), f)) out.append(chunk, got);
    const bool failed = std::ferror(f) != 0;
    std::fclose(f);
    if (failed) { errorOut = path + ": read error"; return false; }
    return true;
}

bool isOneOf(const std::string& key, std::initializer_list<const char*> known) {
    for (const char* k : known) {
        if (key == k) return true;
    }
    return false;
}

/// Copies every key of `source` that `known` does not claim into `out`. This
/// is what keeps a field the rewrite has never heard of alive across a save.
void collectExtras(const Json& source, std::initializer_list<const char*> known, Json& out) {
    out = Json::object();
    if (!source.isObject()) return;
    for (const std::string& key : source.keys()) {
        if (!isOneOf(key, known)) out[key] = source[key];
    }
}

void appendExtras(const Json& extra, Json& out) {
    if (!extra.isObject()) return;
    for (const std::string& key : extra.keys()) out[key] = extra[key];
}

/// Timestamps go out as doubles rather than through Json's integer
/// constructors: std::int64_t is `long` on Linux and `long long` on macOS, and
/// only one of those has an exact overload. Unix millis are well inside a
/// double's exact integer range for the next 200,000 years.
Json millisJson(std::int64_t millis) { return Json(static_cast<double>(millis)); }

// -- record <-> JSON ---------------------------------------------------------

PlayerRecord playerFromJson(const Json& value) {
    PlayerRecord record;
    if (!value.isObject()) return record;

    record.totalXp = value["totalXP"].asDouble(0);
    record.stars = value["stars"].asInt(0);
    record.dailyStreak = value["dailyStreak"].asInt(0);
    record.lastStreakDate = value["lastStreakDate"].asString();
    record.renderFlags = static_cast<std::uint32_t>(value["renderFlags"].asDouble(0));
    record.equippedSkinId = value["equippedSkinId"].asString();

    if (value["inventory"].isObject()) record.inventory = value["inventory"];
    if (value["mobKills"].isObject()) record.mobKills = value["mobKills"];
    if (value["loadout"].isArray()) {
        for (const Json& slot : value["loadout"].items()) {
            if (slot.isObject()) record.loadout.push_back(StoredItem::fromJson(slot));
            else record.loadout.push_back(std::nullopt);
        }
    }

    collectExtras(value, {"totalXP", "stars", "dailyStreak", "lastStreakDate", "renderFlags",
                          "equippedSkinId", "inventory", "mobKills", "loadout"},
                  record.extra);
    return record;
}

Json playerToJson(const PlayerRecord& record) {
    Json out = Json::object();
    out["totalXP"] = record.totalXp;
    out["inventory"] = record.inventory;
    if (!record.loadout.empty()) {
        Json slots = Json::array();
        for (const std::optional<StoredItem>& slot : record.loadout) {
            slots.push(slot ? slot->toJson() : Json());
        }
        out["loadout"] = slots;
    }
    if (record.mobKills.isObject() && record.mobKills.size() > 0) out["mobKills"] = record.mobKills;
    // Optional fields are written only when they carry information. A missing
    // key and an explicit 0/false read identically to every consumer, and this
    // file has one record per account -- the noise is not free.
    if (record.stars != 0) out["stars"] = record.stars;
    if (record.renderFlags != 0) out["renderFlags"] = static_cast<double>(record.renderFlags);
    if (!record.equippedSkinId.empty()) out["equippedSkinId"] = record.equippedSkinId;
    if (record.dailyStreak != 0) out["dailyStreak"] = record.dailyStreak;
    if (!record.lastStreakDate.empty()) out["lastStreakDate"] = record.lastStreakDate;
    appendExtras(record.extra, out);
    return out;
}

Account accountFromJson(const Json& value, const std::string& storedKey) {
    Account account;
    if (!value.isObject()) { account.username = storedKey; return account; }

    account.id = value["id"].asString();
    account.username = value["username"].asString(storedKey);
    account.passwordHash = value["password"].asString();
    account.isPlainText = value["isPlainText"].asBool(false);
    account.admin = value["admin"].asBool(false);
    account.lastActiveAtMillis = static_cast<std::int64_t>(value["lastActiveAt"].asDouble(0));
    account.muted = value["muted"].asBool(false);
    account.mutedAtMillis = static_cast<std::int64_t>(value["mutedAt"].asDouble(0));
    account.mutedBy = value["mutedBy"].asString();

    collectExtras(value, {"id", "username", "password", "isPlainText", "admin", "lastActiveAt",
                          "muted", "mutedAt", "mutedBy"},
                  account.extra);
    return account;
}

Json accountToJson(const Account& account) {
    Json out = Json::object();
    out["id"] = account.id;
    out["username"] = account.username;
    out["password"] = account.passwordHash;
    if (account.isPlainText) out["isPlainText"] = true;
    if (account.admin) out["admin"] = true;
    if (account.lastActiveAtMillis != 0) out["lastActiveAt"] = millisJson(account.lastActiveAtMillis);
    if (account.muted) {
        out["muted"] = true;
        if (account.mutedAtMillis != 0) out["mutedAt"] = millisJson(account.mutedAtMillis);
        if (!account.mutedBy.empty()) out["mutedBy"] = account.mutedBy;
    }
    appendExtras(account.extra, out);
    return out;
}

Database::Session sessionFromJson(const Json& value, const std::string& storedKey) {
    Database::Session session;
    session.tokenHash = value["tokenHash"].asString(storedKey);
    session.userId = value["userId"].asString();
    session.username = value["username"].asString();
    session.createdAtMillis = static_cast<std::int64_t>(value["createdAt"].asDouble(0));
    session.expiresAtMillis = static_cast<std::int64_t>(value["expiresAt"].asDouble(0));
    return session;
}

Json sessionToJson(const Database::Session& session) {
    Json out = Json::object();
    out["tokenHash"] = session.tokenHash;
    out["userId"] = session.userId;
    out["username"] = session.username;
    out["createdAt"] = millisJson(session.createdAtMillis);
    out["expiresAt"] = millisJson(session.expiresAtMillis);
    return out;
}

} // namespace

// ---------------------------------------------------------------------------
// StoredItem
// ---------------------------------------------------------------------------

StoredItem StoredItem::fromJson(const Json& value) {
    StoredItem item;
    if (!value.isObject()) return item;

    item.type = value["type"].asString("petal");
    item.rarity = parseRarity(value["rarity"].asString("common"));
    item.petalType = value["petalType"].asString();
    if (value["health"].isNumber()) {
        item.health = value["health"].asDouble();
        item.hasHealth = true;
    }
    if (value["maxHealth"].isNumber()) {
        item.maxHealth = value["maxHealth"].asDouble();
        item.hasMaxHealth = true;
    }
    collectExtras(value, {"type", "rarity", "petalType", "health", "maxHealth"}, item.extra);
    return item;
}

Json StoredItem::toJson() const {
    Json out = Json::object();
    out["type"] = type;
    out["rarity"] = std::string(rarityName(rarity));
    if (!petalType.empty()) out["petalType"] = petalType;
    if (hasHealth) out["health"] = health;
    if (hasMaxHealth) out["maxHealth"] = maxHealth;
    appendExtras(extra, out);
    return out;
}

// ---------------------------------------------------------------------------
// PlayerRecord
// ---------------------------------------------------------------------------

int PlayerRecord::itemCount(Rarity rarity, const std::string& itemType) const {
    const Json& bucket = inventory[std::string(rarityName(rarity))];
    if (!bucket.isObject()) return 0;
    return bucket[itemType].asInt(0);
}

void PlayerRecord::setItemCount(Rarity rarity, const std::string& itemType, int count) {
    const std::string tier = rarityName(rarity);
    if (count <= 0) {
        if (!inventory.contains(tier)) return;
        Json& bucket = inventory[tier];
        if (!bucket.isObject()) return;
        bucket.erase(itemType);
        // An empty tier is dropped so the file does not accumulate rubble from
        // every petal a player has ever crafted away.
        if (bucket.size() == 0) inventory.erase(tier);
        return;
    }
    // operator[] promotes a missing or non-object tier into an object.
    inventory[tier][itemType] = count;
}

void PlayerRecord::addItem(Rarity rarity, const std::string& itemType, int delta) {
    setItemCount(rarity, itemType, itemCount(rarity, itemType) + delta);
}

int PlayerRecord::killCount(const std::string& mobType, Rarity rarity) const {
    const Json& bucket = mobKills[mobType];
    if (!bucket.isObject()) return 0;
    return bucket[std::string(rarityName(rarity))].asInt(0);
}

void PlayerRecord::recordKill(const std::string& mobType, Rarity rarity) {
    const std::string tier = rarityName(rarity);
    mobKills[mobType][tier] = killCount(mobType, rarity) + 1;
}

// ---------------------------------------------------------------------------
// Database: lifecycle and persistence
// ---------------------------------------------------------------------------

Database::~Database() {
    // The rate limit means the last change of a session is usually still in
    // memory when the process is asked to stop. Flushing here is what turns
    // an orderly shutdown into a lossless one.
    if (dirty_ && !loadFailed_ && !path_.empty()) save();
}

void Database::reset() {
    users_.clear();
    players_.clear();
    sessions_.clear();
    usersByLowerName_.clear();
    usersById_.clear();
    otherTop_ = Json::object();
    topKeyOrder_.clear();
    path_.clear();
    loadFailed_ = false;
    dirty_ = false;
    everWrote_ = false;
    lastWriteMillis_ = 0;
}

bool Database::load(const std::string& path, std::string& errorOut) {
    reset();
    path_ = path;

    if (!fileExists(path)) {
        // A first run, not a failure. Dirty so the file appears on the first
        // save rather than only once a player happens to earn something.
        dirty_ = true;
        return true;
    }

    std::string text;
    if (!readWholeFile(path, text, errorOut)) {
        loadFailed_ = true;
        return false;
    }

    Json root;
    std::string parseError;
    if (!Json::parse(text, root, parseError)) {
        loadFailed_ = true;
        errorOut = path + ": " + parseError;
        return false;
    }
    if (!parseRoot(root, errorOut)) {
        loadFailed_ = true;
        return false;
    }
    pruneExpiredSessions();
    return true;
}

bool Database::parseRoot(const Json& root, std::string& errorOut) {
    if (!root.isObject()) {
        errorOut = path_ + ": top level is not a JSON object";
        return false;
    }
    topKeyOrder_ = root.keys();

    for (const std::string& key : root.keys()) {
        const Json& value = root[key];
        // A collection that is present but is not an object is corruption, not
        // an old schema. Treating it as "no accounts" and carrying on is how a
        // damaged file becomes an empty one.
        if (key == "players" || key == "users" || key == "sessions") {
            if (!value.isObject()) {
                errorOut = path_ + ": \"" + key + "\" is not a JSON object";
                return false;
            }
        }

        if (key == "players") {
            for (const std::string& userId : value.keys()) {
                players_.insert(userId) = playerFromJson(value[userId]);
            }
        } else if (key == "users") {
            for (const std::string& name : value.keys()) {
                Account& account = users_.insert(name);
                account = accountFromJson(value[name], name);
                indexUser(name, account);
            }
        } else if (key == "sessions") {
            for (const std::string& tokenHash : value.keys()) {
                sessions_.insert(tokenHash) = sessionFromJson(value[tokenHash], tokenHash);
            }
        } else {
            otherTop_[key] = value;
        }
    }
    return true;
}

Json Database::toJson() const {
    Json players = Json::object();
    for (const std::string& userId : players_.keys()) {
        players[userId] = playerToJson(*players_.find(userId));
    }
    Json users = Json::object();
    for (const std::string& name : users_.keys()) {
        users[name] = accountToJson(*users_.find(name));
    }
    Json sessions = Json::object();
    for (const std::string& tokenHash : sessions_.keys()) {
        sessions[tokenHash] = sessionToJson(*sessions_.find(tokenHash));
    }

    // Rebuild in the order the file was read in, so a save diffs cleanly
    // against the backup it came from.
    Json root = Json::object();
    bool wrotePlayers = false, wroteUsers = false, wroteSessions = false;
    for (const std::string& key : topKeyOrder_) {
        if (key == "players") { root["players"] = players; wrotePlayers = true; }
        else if (key == "users") { root["users"] = users; wroteUsers = true; }
        else if (key == "sessions") { root["sessions"] = sessions; wroteSessions = true; }
        else { root[key] = otherTop_[key]; }
    }
    if (!wrotePlayers) root["players"] = players;
    if (!wroteUsers) root["users"] = users;
    // `sessions` is created lazily, matching the old server: a database that
    // has never issued one does not grow an empty key for it.
    if (!wroteSessions && sessions.size() > 0) root["sessions"] = sessions;
    return root;
}

bool Database::save() {
    // The whole point of the flag. The in-memory database is the empty
    // default when a load fails, and writing that out turns a file an operator
    // can still repair into total, permanent account loss.
    if (loadFailed_ || path_.empty()) return false;

    const std::string text = toJson().dump(0);
    const std::string tmp = path_ + ".tmp";

    std::FILE* file = std::fopen(tmp.c_str(), "wb");
    if (!file) return false;
    const std::size_t written = text.empty() ? 0 : std::fwrite(text.data(), 1, text.size(), file);
    const bool flushed = std::fflush(file) == 0;
    if (flushed) ::fsync(::fileno(file));
    const bool closed = std::fclose(file) == 0;
    if (written != text.size() || !flushed || !closed) {
        std::remove(tmp.c_str());
        return false;
    }

    // Verify before promoting. The failure this actually guards against is
    // truncation -- the process dying mid-write, or a full disk -- and a
    // truncated file is a SHORT one, which a length compare catches for free.
    // Re-parsing the file instead would cost megabytes of work per save to
    // catch a corruption mode a healthy filesystem does not produce.
    struct stat info {};
    if (::stat(tmp.c_str(), &info) != 0 ||
        static_cast<std::size_t>(info.st_size) != text.size()) {
        std::remove(tmp.c_str());
        return false;
    }

    // rename(2) is atomic within a filesystem: either the old file or the new
    // one is there, never a half of either.
    if (std::rename(tmp.c_str(), path_.c_str()) != 0) {
        std::remove(tmp.c_str());
        return false;
    }
    dirty_ = false;
    return true;
}

bool Database::maybeSave(std::int64_t nowMillis) {
    if (!dirty_ || loadFailed_ || path_.empty()) return false;
    if (everWrote_ && nowMillis - lastWriteMillis_ < kMinWriteIntervalMillis) return false;
    const bool ok = save();
    // The stamp moves even on failure: a disk that is refusing writes must not
    // be retried every tick. The record stays dirty, so the next window tries
    // again and nothing is lost.
    lastWriteMillis_ = nowMillis;
    everWrote_ = true;
    return ok;
}

std::int64_t Database::nowMillis() const {
    if (clock_) return clock_();
    return std::chrono::duration_cast<std::chrono::milliseconds>(
               std::chrono::system_clock::now().time_since_epoch())
        .count();
}

// ---------------------------------------------------------------------------
// Database: accounts
// ---------------------------------------------------------------------------

void Database::indexUser(const std::string& storedKey, const Account& account) {
    // emplace, not assignment: a legacy file may contain both "Bob" and "bob"
    // as separate accounts. Both records are kept -- deleting one on load
    // would be data loss -- and the first spelling wins the lookup. New
    // registrations can no longer create that situation.
    usersByLowerName_.emplace(toLower(storedKey), storedKey);
    if (!account.id.empty()) usersById_.emplace(account.id, storedKey);
}

Account* Database::findUser(const std::string& username) {
    if (username.empty()) return nullptr;
    if (Account* exact = users_.find(username)) return exact;
    auto it = usersByLowerName_.find(toLower(username));
    if (it == usersByLowerName_.end()) return nullptr;
    return users_.find(it->second);
}

const Account* Database::findUser(const std::string& username) const {
    return const_cast<Database*>(this)->findUser(username);
}

Account* Database::findUserById(const std::string& userId) {
    auto it = usersById_.find(userId);
    if (it == usersById_.end()) return nullptr;
    return users_.find(it->second);
}

std::string Database::canonicalUsername(const std::string& username) const {
    const Account* account = findUser(username);
    return account ? account->username : std::string();
}

bool Database::validUsername(const std::string& username, std::string& reasonOut) {
    if (username.size() < 3 || username.size() > 20) {
        reasonOut = "usernames must be 3 to 20 characters";
        return false;
    }
    // Names are drawn on nameplates and typed at admin commands, so anything
    // that can be mistaken for a different name -- spaces, combining marks,
    // control characters, right-to-left overrides -- is refused at the door
    // rather than sanitised at every place a name is used.
    for (char c : username) {
        const bool allowed = (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') ||
                             (c >= '0' && c <= '9') || c == '_';
        if (!allowed) {
            reasonOut = "usernames may use letters, digits and underscore only";
            return false;
        }
    }
    if (username[0] == '_') {
        reasonOut = "usernames must start with a letter or a digit";
        return false;
    }
    return true;
}

bool Database::validPassword(const std::string& password, std::string& reasonOut) {
    if (password.size() < 8) {
        reasonOut = "passwords must be at least 8 characters";
        return false;
    }
    // bcrypt silently ignores everything past its 72nd byte. Accepting a
    // longer password would mean anyone who typed the first 72 characters got
    // in -- so the limit is enforced here, where it can be explained, rather
    // than hidden inside the hash.
    if (password.size() > crypto::kBcryptMaxPasswordBytes) {
        reasonOut = "passwords must be at most 72 bytes";
        return false;
    }
    for (char c : password) {
        const auto byte = static_cast<unsigned char>(c);
        if (byte < 0x20 || byte == 0x7F) {
            reasonOut = "passwords may not contain control characters";
            return false;
        }
    }
    return true;
}

void Database::setPasswordCost(int cost) {
    passwordCost_ = clamp(cost, crypto::kBcryptMinCost, crypto::kBcryptMaxCost);
}

std::string Database::newUserId() {
    static const char kAlphabet[] = "0123456789abcdefghijklmnopqrstuvwxyz";
    for (int attempt = 0; attempt < 64; ++attempt) {
        std::uint8_t raw[12];
        crypto::secureRandom().bytes(raw, sizeof(raw));
        std::string id;
        id.reserve(sizeof(raw));
        // The modulo bias is real and irrelevant: an id has to be unique, not
        // uniform, and 12 base-36 characters is ~62 bits either way.
        for (std::uint8_t byte : raw) id.push_back(kAlphabet[byte % 36]);
        if (usersById_.find(id) == usersById_.end()) return id;
    }
    return {};
}

CreateResult Database::createUser(const std::string& username, const std::string& password) {
    CreateResult result;
    if (!validUsername(username, result.reason)) {
        result.status = CreateStatus::UsernameInvalid;
        return result;
    }
    if (!validPassword(password, result.reason)) {
        result.status = CreateStatus::PasswordInvalid;
        return result;
    }
    if (findUser(username) != nullptr) {
        result.status = CreateStatus::UsernameTaken;
        result.reason = "that name is already registered";
        return result;
    }
    const std::string id = newUserId();
    if (id.empty()) {
        result.status = CreateStatus::ServerError;
        result.reason = "could not allocate an account id";
        return result;
    }

    Account& account = users_.insert(username);
    account.id = id;
    account.username = username;
    account.passwordHash = crypto::bcryptHash(password, passwordCost_);
    indexUser(username, account);
    // Give the account its (empty) progress row now, so `players` and `users`
    // never disagree about who exists.
    players_.insert(id);
    markDirty();

    result.account = &account;
    return result;
}

bool Database::verifyPassword(const std::string& username, const std::string& password) {
    Account* account = findUser(username);
    if (!account) return false;

    bool ok = false;
    if (crypto::isBcryptHash(account->passwordHash)) {
        // The stored value's shape decides, not the isPlainText flag: the old
        // server tested `startsWith('$2b$')` and so mistook every $2a$ hash
        // for a plaintext password. A bcrypt hash is never something a player
        // typed, so this branch is always the right one when it matches.
        ok = crypto::bcryptVerify(password, account->passwordHash);
    } else {
        ok = crypto::constantTimeEquals(account->passwordHash, password);
        if (ok) {
            // The one moment the plaintext is available. Upgrade in place; the
            // account never stores a bare password again.
            account->passwordHash = crypto::bcryptHash(password, passwordCost_);
            account->isPlainText = false;
        }
    }
    if (!ok) return false;

    account->lastActiveAtMillis = nowMillis();
    markDirty();
    return true;
}

// ---------------------------------------------------------------------------
// Database: sessions
// ---------------------------------------------------------------------------

std::string Database::createSession(const std::string& userId, const std::string& username) {
    // 32 bytes: a token has to be unguessable in the whole keyspace, since a
    // guess is a login. Hex rather than base64 so it survives being pasted
    // into a URL, a header, or a support ticket unchanged.
    const std::string token = crypto::secureRandom().hex(32);
    const std::string tokenHash = crypto::sha256Hex(token);
    const std::int64_t now = nowMillis();

    pruneExpiredSessions();

    Session& session = sessions_.insert(tokenHash);
    session.tokenHash = tokenHash;
    session.userId = userId;
    session.username = username;
    session.createdAtMillis = now;
    session.expiresAtMillis = now + kSessionTtlMillis;
    markDirty();
    return token;
}

const Database::Session* Database::resolveSession(const std::string& token) {
    if (token.empty()) return nullptr;
    const std::string tokenHash = crypto::sha256Hex(token);
    Session* session = sessions_.find(tokenHash);
    if (!session) return nullptr;

    const std::int64_t now = nowMillis();
    if (session->expiresAtMillis <= now) {
        sessions_.erase(tokenHash);
        markDirty();
        return nullptr;
    }
    // The account may have been renamed or deleted since the token was issued.
    // A session must never resurrect an account or land on a different one
    // that has since taken the name.
    Account* account = findUser(session->username);
    if (!account || account->id != session->userId) {
        sessions_.erase(tokenHash);
        markDirty();
        return nullptr;
    }

    account->lastActiveAtMillis = now;
    markDirty();
    return session;
}

void Database::revokeSession(const std::string& token) {
    if (token.empty()) return;
    if (sessions_.erase(crypto::sha256Hex(token))) markDirty();
}

int Database::revokeSessionsForUser(const std::string& username) {
    std::vector<std::string> doomed;
    for (const std::string& tokenHash : sessions_.keys()) {
        const Session* session = sessions_.find(tokenHash);
        if (session && session->username == username) doomed.push_back(tokenHash);
    }
    for (const std::string& tokenHash : doomed) sessions_.erase(tokenHash);
    if (!doomed.empty()) markDirty();
    return static_cast<int>(doomed.size());
}

int Database::pruneExpiredSessions() {
    const std::int64_t now = nowMillis();
    std::vector<std::string> doomed;
    for (const std::string& tokenHash : sessions_.keys()) {
        const Session* session = sessions_.find(tokenHash);
        if (session && session->expiresAtMillis <= now) doomed.push_back(tokenHash);
    }
    for (const std::string& tokenHash : doomed) sessions_.erase(tokenHash);
    if (!doomed.empty()) markDirty();
    return static_cast<int>(doomed.size());
}

// ---------------------------------------------------------------------------
// Database: progress
// ---------------------------------------------------------------------------

PlayerRecord& Database::progress(const std::string& userId) {
    const bool fresh = players_.find(userId) == nullptr;
    PlayerRecord& record = players_.insert(userId);
    if (fresh) markDirty();
    return record;
}

const PlayerRecord* Database::findProgress(const std::string& userId) const {
    return players_.find(userId);
}

} // namespace flr
