#pragma once
// The guild record's shape, as pure functions over the JSON the database
// stores it in.
//
// Guilds live in the browser build's own `guilds` table -- an object keyed by
// the upper-cased five-character name, each value carrying {name,
// leaderUsername, memberUsernames, createdAt} -- and are held as JSON rather
// than mirrored into a typed cache because the same file is read by the
// browser build, and a second copy is a second thing to keep true.
//
// Shared between the guild message handlers and the chat commands that reach
// the same records (`/guild-info`, `/guild-list`, `/admin guild_force_join`).

#include <cstdint>
#include <string>

#include "server/text.h"
#include "shared/core/json.h"

namespace flix {

inline constexpr std::size_t kMaxGuildSize = 200;
/// A guild invitation lapses after a minute, as the reference's does.
inline constexpr std::int64_t kGuildInviteMillis = 60000;

/// A guild's name IS its key: trimmed and upper-cased, so "alpha" and " Alpha "
/// are the same guild and cannot both be created.
inline std::string normalizeGuildName(const std::string& raw) {
    std::string name = trimmed(raw);
    for (char& c : name) c = static_cast<char>(std::toupper(static_cast<unsigned char>(c)));
    return name;
}

/// Exactly five A-Z or 0-9, which is what makes the name short enough to hang
/// under a nameplate as a tag.
inline bool validGuildName(const std::string& name) {
    if (name.size() != 5) return false;
    for (const char c : name) {
        const auto byte = static_cast<unsigned char>(c);
        if (!std::isupper(byte) && !std::isdigit(byte)) return false;
    }
    return true;
}

/// Position of `username` in a guild's member array, or -1.
inline int guildMemberIndex(const Json& guild, const std::string& username) {
    const Json& members = guild["memberUsernames"];
    const std::string key = lowerCase(username);
    for (std::size_t i = 0; i < members.size(); ++i) {
        if (lowerCase(members[i].asString()) == key) return static_cast<int>(i);
    }
    return -1;
}

} // namespace flix
