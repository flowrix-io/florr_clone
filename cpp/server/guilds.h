#pragma once
// The guild record's shape, as pure functions over the JSON the database
// stores it in.
//
// Guilds live in the browser build's own `guilds` table -- an object keyed by
// the upper-cased five-character name, each value carrying {name,
// leaderUsername, memberUsernames, createdAt} -- and are held as JSON in that
// shape, which existing database files carry, rather than mirrored into a
// typed cache: a second copy is a second thing to keep true.
//
// Two optional fields ride beside those: `displayName`, the free-text name the
// panel heads the card with, and `description`. The five-character `name` is
// the guild's TAG -- its key, and what hangs under a nameplate in brackets. A
// record written before either field existed has neither, which reads as a
// display name equal to the tag and no description.
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

inline constexpr std::size_t kMaxGuildDisplayName = 20;
inline constexpr std::size_t kMaxGuildDescription = 120;

/// Printable ASCII and nothing else. The panel's prompts take only that, and
/// holding the server to it keeps a control character or a glyph the client's
/// one font cannot draw out of a card every member sees.
inline bool printableAscii(const std::string& s) {
    for (const char c : s) {
        const auto byte = static_cast<unsigned char>(c);
        if (byte < 0x20 || byte > 0x7E) return false;
    }
    return true;
}

/// One to kMaxGuildDisplayName printable characters, already trimmed.
inline bool validGuildDisplayName(const std::string& name) {
    return !name.empty() && name.size() <= kMaxGuildDisplayName && printableAscii(name);
}

/// Up to kMaxGuildDescription printable characters. Empty is allowed: it is
/// how a leader clears one.
inline bool validGuildDescription(const std::string& description) {
    return description.size() <= kMaxGuildDescription && printableAscii(description);
}

/// What the card is headed with: the display name, or the tag for a guild that
/// has none.
inline std::string guildDisplayName(const Json& guild) {
    const std::string name = guild["displayName"].asString();
    return name.empty() ? guild["name"].asString() : name;
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
