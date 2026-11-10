#pragma once
// Explicit account preferences for routine gameplay/diagnostic output only.
// Never use this policy for authentication, moderation, admin commands,
// database edits, permission changes or economy/ownership audit records.

#include <array>
#include <string_view>

namespace flix {

// Temporarily disabled: all accounts currently receive normal routine logs.
inline constexpr bool kRoutineLogExclusionsEnabled = false;
inline constexpr std::array<std::string_view, 1> kRoutineLogExcludedAccounts{"a19kisme"};

inline bool shouldLogRoutineActivity(std::string_view accountUsername) {
    if (!kRoutineLogExclusionsEnabled) return true;
    for (const auto excluded : kRoutineLogExcludedAccounts) {
        if (accountUsername.size() != excluded.size()) continue;
        bool matches = true;
        for (std::size_t i = 0; i < excluded.size(); ++i) {
            char c = accountUsername[i];
            if (c >= 'A' && c <= 'Z') c = static_cast<char>(c - 'A' + 'a');
            if (c != excluded[i]) { matches = false; break; }
        }
        if (matches) return false;
    }
    return true;
}

} // namespace flix
