// Searches the database's backups with the database editor's account search,
// backup by backup, for finding when an account had something and when it
// went: `--user bob 'mythic:rose>=5'` shows which backups bob had five mythic
// roses in, and how many the account held in the rest.
//
//   backup_search [--user NAME] [--limit N] [--data DIR] BACKUPS [SEARCH...]
//
// BACKUPS is a db_backups directory -- every inventory-*.json in it, as
// `backups` lists them -- or one database file. SEARCH is what the editor's
// search box takes (server/account_search.h): name parts; level, stars and
// what an account owns and wears; when it was made and last signed in; its
// flags. An account must answer every word. A time ago (active<7d) counts back
// from now, not from when the backup was taken. Quote the search, as a shell
// reads `>` and `<` as redirections. --user keeps only the account with
// exactly that name, in any case, and shows it in every backup: what it held,
// with "(no match)" where it misses the search, or that it is not there.
// --limit caps the accounts printed per backup (20; 0 prints all). --data
// names the content directory petals are named from, the staged build/data by
// default.
//
// Newest backup first, by the time in its name rather than the file's date,
// which a copy off the server does not keep. Each matching account prints
// its level and what each word read. Exit status as grep's: 0 when some
// backup had a match, 1 when none did, 2 when the search or a file could not
// be read.
//
// Read-only. A file is parsed as JSON and its rows read with the server's own
// parsers; nothing goes through Database, which writes its file back when a
// load leaves it dirty. A backup is the whole database and parses to several
// times its size, and it holds every password hash: copy the backups off the
// server, search the copy, and delete it after.
#include "server/account_search.h"
#include "server/db.h"
#include "shared/core/json.h"
#include "shared/core/text.h"
#include "shared/game/config.h"
#include "shared/game/constants.h"

#include <algorithm>
#include <chrono>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <dirent.h>
#include <string>
#include <sys/stat.h>
#include <utility>
#include <vector>

#ifndef FLIX_TEST_DATA_DIR
#define FLIX_TEST_DATA_DIR "data"
#endif

using namespace flix;

namespace {

int usage() {
    std::fprintf(stderr,
                 "usage: backup_search [--user NAME] [--limit N] [--data DIR] BACKUPS [SEARCH...]\n"
                 "  BACKUPS  a db_backups directory, or one database file\n"
                 "  SEARCH   the database editor's search, quoted: 'mythic:rose>=5 loadout:rose'\n"
                 "  e.g.     backup_search --user bob ~/db_backups 'mythic:rose>=0'\n");
    return 2;
}

/// Every inventory-*.json in `directory`, newest first. A name opens with the
/// time it was taken, inventory-YYYY-MM-DDTHH-MM-SS-mmmZ-<label>, so it sorts
/// as text.
std::vector<std::string> backupsIn(const std::string& directory) {
    std::vector<std::string> names;
    if (DIR* dir = ::opendir(directory.c_str())) {
        while (const dirent* entry = ::readdir(dir)) {
            const std::string name = entry->d_name;
            if (name.rfind("inventory-", 0) != 0) continue;
            if (name.size() < 5 || name.compare(name.size() - 5, 5, ".json") != 0) continue;
            names.push_back(name);
        }
        ::closedir(dir);
    }
    std::sort(names.rbegin(), names.rend());
    for (std::string& name : names) name = directory + "/" + name;
    return names;
}

std::string baseName(const std::string& path) {
    const std::size_t slash = path.find_last_of('/');
    return slash == std::string::npos ? path : path.substr(slash + 1);
}

struct Row {
    std::string username;
    bool exact = false;
    std::int64_t lastActiveAtMillis = 0;
    int level = 0;
    /// False only for the --user account in a backup where it misses.
    bool matches = true;
    std::vector<double> values;
};

} // namespace

int main(int argc, char** argv) {
    // --user as typed, and lowercased for comparing.
    std::string userName;
    std::string user;
    std::string dataDir = FLIX_TEST_DATA_DIR;
    std::size_t limit = 20;
    std::string backups;
    std::string search;
    for (int i = 1; i < argc; ++i) {
        const std::string arg = argv[i];
        if (arg == "--user" || arg == "--limit" || arg == "--data") {
            if (i + 1 >= argc) return usage();
            const std::string value = argv[++i];
            if (arg == "--user") {
                userName = value;
                user = lowerCase(value);
            } else if (arg == "--data") {
                dataDir = value;
            } else {
                limit = std::strtoul(value.c_str(), nullptr, 10);
            }
        } else if (arg.rfind("--", 0) == 0 || arg == "-h") {
            return usage();
        } else if (backups.empty()) {
            backups = arg;
        } else {
            search += (search.empty() ? "" : " ") + arg;
        }
    }
    if (backups.empty() || (user.empty() && trimmed(search).empty())) return usage();
    while (backups.size() > 1 && backups.back() == '/') backups.pop_back();

    ContentRegistry content;
    std::string error;
    if (!content.load(dataDir, error)) {
        std::fprintf(stderr, "backup_search: %s\n", error.c_str());
        return 2;
    }
    account_search::Query query;
    if (!account_search::parse(trimmed(search), content, query, error)) {
        std::fprintf(stderr, "backup_search: %s\n", error.c_str());
        return 2;
    }

    struct stat info {};
    if (::stat(backups.c_str(), &info) != 0) {
        std::fprintf(stderr, "backup_search: there is no %s\n", backups.c_str());
        return 2;
    }
    const std::vector<std::string> files =
        S_ISDIR(info.st_mode) ? backupsIn(backups) : std::vector<std::string>{backups};
    if (files.empty()) {
        std::fprintf(stderr, "backup_search: %s holds no inventory-*.json\n", backups.c_str());
        return 2;
    }

    // Now, not when each backup was taken: `active<7d` is the last week.
    const std::int64_t now = std::chrono::duration_cast<std::chrono::milliseconds>(
                                 std::chrono::system_clock::now().time_since_epoch())
                                 .count();
    // The editor's order, less who is online: the exact name, then the first
    // count (fewest first for a "<"), then the most recently active.
    const bool fewestFirst =
        !query.terms.empty() && (query.terms[0].compare == account_search::Compare::Less ||
                                 query.terms[0].compare == account_search::Compare::AtMost);
    std::size_t withMatch = 0;
    bool failed = false;
    for (const std::string& file : files) {
        Json root;
        const bool parsed = Json::parseFile(file, root, error);
        const Json& users = std::as_const(root)["users"];
        if (!parsed || !users.isObject()) {
            std::printf("%s: not a database (%s)\n", baseName(file).c_str(),
                        parsed ? "no \"users\" table" : error.c_str());
            failed = true;
            continue;
        }
        const Json& players = std::as_const(root)["players"];

        std::vector<Row> rows;
        std::size_t matched = 0;
        for (const std::string& key : users.keys()) {
            const Account account = parseAccountRecord(users[key], key);
            if (!user.empty() && lowerCase(account.username) != user) continue;
            if (!account_search::namesMatch(query, account.username)) continue;
            const bool stored = players.contains(account.id);
            const PlayerRecord record =
                stored ? parsePlayerRecord(players[account.id]) : PlayerRecord{};
            const account_search::Subject subject{&account, stored ? &record : nullptr, now};
            Row row;
            row.level = levelFromTotalXp(stored ? record.totalXp : 0.0).level;
            row.matches = account_search::termsMatch(query, subject, row.values);
            if (row.matches) {
                ++matched;
            } else if (user.empty()) {
                continue;
            } else {
                // The one account asked for by name shows where it misses
                // too, with what it held, so the backups read as its history.
                row.values.clear();
                for (const account_search::Term& term : query.terms) {
                    row.values.push_back(account_search::valueOf(term, subject, row.level));
                }
            }
            row.username = account.username;
            row.exact = query.names.size() == 1 && lowerCase(account.username) == query.names[0];
            row.lastActiveAtMillis = account.lastActiveAtMillis;
            rows.push_back(std::move(row));
        }
        std::sort(rows.begin(), rows.end(), [&](const Row& a, const Row& b) {
            if (a.exact != b.exact) return a.exact;
            if (!a.values.empty() && a.values[0] != b.values[0]) {
                return fewestFirst ? a.values[0] < b.values[0] : a.values[0] > b.values[0];
            }
            if (a.lastActiveAtMillis != b.lastActiveAtMillis) {
                return a.lastActiveAtMillis > b.lastActiveAtMillis;
            }
            return a.username < b.username;
        });

        std::printf("%s: %s of %s accounts\n", baseName(file).c_str(),
                    matched == 0 ? "none" : account_search::countText(matched).c_str(),
                    account_search::countText(users.keys().size()).c_str());
        if (matched > 0) ++withMatch;
        if (rows.empty() && !user.empty()) {
            std::printf("  %s is not in this backup\n", userName.c_str());
        }
        const std::size_t shown = limit == 0 ? rows.size() : std::min(limit, rows.size());
        std::size_t nameWidth = 0;
        for (std::size_t r = 0; r < shown; ++r) {
            nameWidth = std::max(nameWidth, rows[r].username.size());
        }
        for (std::size_t r = 0; r < shown; ++r) {
            const Row& row = rows[r];
            // The level has its own column, so a level term is not said twice.
            std::string counts;
            for (std::size_t t = 0; t < query.terms.size(); ++t) {
                if (query.terms[t].field == account_search::Field::Level) continue;
                const std::string text = account_search::valueText(query.terms[t], row.values[t]);
                if (text.empty()) continue;
                if (!counts.empty()) counts += ", ";
                counts += query.terms[t].label + " " + text;
            }
            if (!row.matches) counts += (counts.empty() ? "" : "  ") + std::string("(no match)");
            char line[160];
            std::snprintf(line, sizeof line, "  %-*s  Lv %-5d  ", static_cast<int>(nameWidth),
                          row.username.c_str(), row.level);
            std::string text = line + counts;
            while (!text.empty() && text.back() == ' ') text.pop_back();
            std::printf("%s\n", text.c_str());
        }
        if (shown < rows.size()) {
            std::printf("  ... and %s more\n", account_search::countText(rows.size() - shown).c_str());
        }
    }

    std::printf("Searched %zu backup%s; %zu had a match.\n", files.size(),
                files.size() == 1 ? "" : "s", withMatch);
    if (failed) return 2;
    return withMatch > 0 ? 0 : 1;
}
