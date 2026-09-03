#pragma once
// The two string operations every name comparison on the server needs.
//
// Shared rather than duplicated per translation unit because the rule they
// encode is a rule, not a convenience: names are compared case-insensitively
// and typed with stray whitespace, and a second copy of either is a second
// place for that to stop being true.

#include <cctype>
#include <string>
#include <vector>

namespace flr {

/// Case folding for every name comparison on the server. Guild membership,
/// account lookup and command targets are all case-insensitive in the
/// reference -- a player invited as "Bob" answers as "bob" -- so nothing that
/// matches a name may compare raw bytes.
inline std::string lowerCase(std::string s) {
    for (char& c : s) c = static_cast<char>(std::tolower(static_cast<unsigned char>(c)));
    return s;
}

inline std::string trimmed(const std::string& s) {
    const std::size_t first = s.find_first_not_of(" \t\r\n");
    if (first == std::string::npos) return {};
    const std::size_t last = s.find_last_not_of(" \t\r\n");
    return s.substr(first, last - first + 1);
}

/// Splits on RUNS of whitespace, dropping empties.
///
/// Runs rather than single spaces: the browser build split `set_bot_count  20`
/// on `' '` and got an empty second field, so a double space silently printed
/// the usage line instead of setting anything. Typing two spaces is not an
/// error worth a diagnostic.
inline std::vector<std::string> splitWords(const std::string& s) {
    std::vector<std::string> words;
    std::size_t at = 0;
    while (at < s.size()) {
        const std::size_t start = s.find_first_not_of(" \t\r\n", at);
        if (start == std::string::npos) break;
        const std::size_t end = s.find_first_of(" \t\r\n", start);
        words.push_back(s.substr(start, end == std::string::npos ? std::string::npos : end - start));
        if (end == std::string::npos) break;
        at = end;
    }
    return words;
}

} // namespace flr
