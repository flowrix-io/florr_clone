#include "server/cluster/membership.h"

#include <cerrno>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <iterator>
#include <fcntl.h>
#include <sys/stat.h>
#include <unistd.h>

#include "shared/core/json.h"

namespace flix::cluster {

namespace {

/// What a database is on disk (Database::replayJournal).
constexpr const char* kDatabaseFiles[] = {"", ".journal", ".journal.next"};

bool exists(const std::string& path) {
    struct stat info {};
    return ::stat(path.c_str(), &info) == 0;
}

bool move(const std::string& from, const std::string& to) {
    return std::rename(from.c_str(), to.c_str()) == 0;
}

} // namespace

std::string membershipPathFor(const std::string& databasePath) { return databasePath + ".cluster"; }
std::string copyPathFor(const std::string& databasePath) { return databasePath + ".replica"; }

bool parseAddress(const std::string& text, std::string& host, std::uint16_t& port) {
    const std::size_t colon = text.rfind(':');
    host = text.substr(0, colon);
    if (host.empty() || host.find(':') != std::string::npos || host.find('/') != std::string::npos) {
        return false;
    }
    if (colon == std::string::npos) return true;
    const std::string digits = text.substr(colon + 1);
    char* end = nullptr;
    const long value = std::strtol(digits.c_str(), &end, 10);
    if (digits.empty() || *end != '\0' || value < 1 || value > 65535) return false;
    port = static_cast<std::uint16_t>(value);
    return true;
}

Membership Membership::load(const std::string& path, std::string& note) {
    Membership m;
    std::FILE* file = std::fopen(path.c_str(), "rb");
    if (file == nullptr) {
        if (errno != ENOENT) note = path + ": " + std::strerror(errno);
        return m;
    }
    std::string text;
    char chunk[512];
    while (const std::size_t got = std::fread(chunk, 1, sizeof chunk, file)) text.append(chunk, got);
    std::fclose(file);
    Json root;
    std::string error;
    if (!Json::parse(text, root, error) || !root.isObject()) {
        note = path + ": " + (error.empty() ? "not an object" : error) + "; running unlinked";
        return m;
    }
    m.key = root["key"].asString();
    m.name = root["name"].asString();
    m.id = root["id"].asString();
    // Only the files of servers that linked on a port of their own have one.
    m.oldLinkPort = root["port"].isNumber();
    m.gatewayHost = root["gateway"].asString();
    m.gatewayPort = static_cast<std::uint16_t>(root["gatewayPort"].asInt(m.gatewayPort));
    const std::string role = root["role"].asString();
    if (!m.key.empty() && role == "gateway") m.role = Role::Gateway;
    if (!m.key.empty() && role == "shard" && !m.gatewayHost.empty()) m.role = Role::Shard;
    return m;
}

bool Membership::save(const std::string& path, std::string& errorOut) const {
    Json root = Json::object();
    root["role"] = Json(std::string(role == Role::Gateway ? "gateway" : role == Role::Shard ? "shard" : "alone"));
    root["key"] = Json(key);
    root["name"] = Json(name);
    root["id"] = Json(id);
    root["gateway"] = Json(gatewayHost);
    root["gatewayPort"] = Json(static_cast<int>(gatewayPort));
    const std::string text = root.dump(2) + "\n";
    const std::string tmp = path + ".tmp";
    std::remove(tmp.c_str());
    // The key is in it: nobody's to read but the server's own user.
    const int fd = ::open(tmp.c_str(), O_WRONLY | O_CREAT | O_EXCL, 0600);
    if (fd < 0) {
        errorOut = tmp + ": " + std::strerror(errno);
        return false;
    }
    const bool written = ::write(fd, text.data(), text.size()) == static_cast<ssize_t>(text.size());
    if (written) ::fsync(fd);
    const bool closed = ::close(fd) == 0;
    if (!written || !closed || !move(tmp, path)) {
        errorOut = path + ": could not be written";
        std::remove(tmp.c_str());
        return false;
    }
    return true;
}

bool promote(const std::string& databasePath, std::string& note) {
    const std::string copy = copyPathFor(databasePath);
    const std::string where = membershipPathFor(databasePath);
    note.clear();
    Membership m = Membership::load(where, note);
    if (!note.empty()) return false;
    if (m.role != Membership::Role::Shard || !exists(copy) || !exists(copy + ".of")) {
        note = exists(copy) ? "this server has no whole copy from the gateway it is linked to"
                            : copy + ": there is no copy here";
        return false;
    }
    // Any of its three files is a database to lose: a first run killed before
    // its first save has only a journal.
    bool had = false;
    for (const char* suffix : kDatabaseFiles) had = had || exists(databasePath + suffix);
    const std::string aside = had ? setAside(databasePath) : std::string();
    if (had && aside.empty()) {
        note = databasePath + ": could not be moved aside";
        return false;
    }
    if (!move(copy, databasePath)) {
        for (const char* suffix : kDatabaseFiles) {
            if (had && exists(aside + suffix)) move(aside + suffix, databasePath + suffix);
        }
        note = copy + ": could not be moved into place";
        return false;
    }
    // The journal follows the file it names, and so does a rotation the copy's
    // last save was in the middle of (Database::replayJournal).
    for (const char* suffix : {".journal", ".journal.next"}) {
        if (exists(copy + suffix)) move(copy + suffix, databasePath + suffix);
    }
    std::remove((copy + ".of").c_str());
    std::remove((copy + ".was").c_str());
    m.role = Membership::Role::Gateway;
    std::string error;
    if (!m.save(where, error)) {
        note = error;
        return false;
    }
    note = had ? "its own database is now " + aside : "it had no database of its own";
    return true;
}

bool unlink(const std::string& databasePath, std::string& note) {
    const std::string path = membershipPathFor(databasePath);
    note.clear();
    Membership m = Membership::load(path, note);
    if (!note.empty()) return false;
    if (m.role == Membership::Role::Alone) {
        note = "it is on its own already";
        return false;
    }
    m.role = Membership::Role::Alone;
    return m.save(path, note);
}

std::string setAside(const std::string& path) {
    const std::size_t slash = path.rfind('/');
    const std::string base =
        (slash == std::string::npos ? std::string() : path.substr(0, slash + 1)) + "database_independent";
    std::string target;
    for (int n = 1; target.empty(); ++n) {
        const std::string name = base + (n == 1 ? std::string() : "-" + std::to_string(n)) + ".json";
        bool taken = false;
        for (const char* suffix : kDatabaseFiles) taken = taken || exists(name + suffix);
        if (!taken) target = name;
    }
    // The file itself last: a stop halfway leaves it where it was, and its
    // journal somewhere that nothing overwrites.
    for (std::size_t i = std::size(kDatabaseFiles); i-- > 0;) {
        const std::string suffix = kDatabaseFiles[i];
        if (!exists(path + suffix) || move(path + suffix, target + suffix)) continue;
        for (const char* back : kDatabaseFiles) {
            if (exists(target + back)) move(target + back, path + back);
        }
        return {};
    }
    // What is put here next is not what these were about.
    std::remove((path + ".of").c_str());
    std::remove((path + ".was").c_str());
    return target;
}

bool isCopyOf(const std::string& path, const std::string& lineage) {
    if (lineage.empty()) return false;
    for (const char* mark : {".of", ".was"}) {
        std::FILE* file = std::fopen((path + mark).c_str(), "rb");
        if (file == nullptr) continue;
        char text[256];
        const std::size_t got = std::fread(text, 1, sizeof text, file);
        std::fclose(file);
        if (std::string(text, got) == lineage) return true;
    }
    return false;
}

bool markCopyOf(const std::string& path, const std::string& lineage) {
    std::FILE* file = std::fopen((path + ".of").c_str(), "wb");
    if (file == nullptr) return false;
    const bool written = std::fwrite(lineage.data(), 1, lineage.size(), file) == lineage.size();
    const bool closed = std::fclose(file) == 0;
    std::remove((path + ".was").c_str());
    return written && closed;
}

void retireCopy(const std::string& databasePath) {
    const std::string copy = copyPathFor(databasePath);
    if (exists(copy + ".of")) move(copy + ".of", copy + ".was");
}

} // namespace flix::cluster
