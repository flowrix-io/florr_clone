// Which slash commands the chat's suggestion list offers for a typed line, and
// in what order.
//
// Kept apart from the chat itself so the ranking can be tested without a
// window: the list Enter completes from is exactly the list this returns.

#pragma once

#include <algorithm>
#include <cstddef>
#include <string>
#include <string_view>
#include <vector>

#include "shared/core/text.h"

namespace flix::ui {

/// Lower case, with every run of spaces made one: "/Admin  Give" and
/// "/admin give" are the same request.
inline std::string normalizedCommandText(std::string_view typed) {
    std::string out;
    out.reserve(typed.size());
    for (const char c : typed) {
        if (c == ' ' && !out.empty() && out.back() == ' ') continue;
        out += c;
    }
    return lowerCase(out);
}

/// Edits (insert, delete, change, or swap two neighbours) from `a` to `b`.
inline int commandEditDistance(std::string_view a, std::string_view b) {
    const std::size_t n = a.size();
    const std::size_t m = b.size();
    std::vector<int> prev2(m + 1, 0), prev(m + 1, 0), cur(m + 1, 0);
    for (std::size_t j = 0; j <= m; ++j) prev[j] = static_cast<int>(j);
    for (std::size_t i = 1; i <= n; ++i) {
        cur[0] = static_cast<int>(i);
        for (std::size_t j = 1; j <= m; ++j) {
            const int cost = a[i - 1] == b[j - 1] ? 0 : 1;
            cur[j] = std::min({prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost});
            if (i > 1 && j > 1 && a[i - 1] == b[j - 2] && a[i - 2] == b[j - 1]) {
                cur[j] = std::min(cur[j], prev2[j - 2] + 1);
            }
        }
        prev2.swap(prev);
        prev.swap(cur);
    }
    return prev[m];
}

/// Indices into `commands` to offer for `typed`, best first:
///
///   1. the command typed exactly -- so Enter on a whole "/admin give" keeps
///      "/admin give" rather than turning it into "/admin give_xp", which sat
///      above it in the table;
///   2. commands that start with what is typed, in table order;
///   3. commands at the same level ("/admin ...") whose last part merely
///      CONTAINS the word being typed: "/admin waves" offers start_waves;
///   4. only when nothing above matched, near misses of that word:
///      "/admin spwan" offers spawn.
///
/// 3 and 4 look only at the word still being typed, and only among commands
/// that share everything before it, so a line that has moved on to its
/// arguments ("/admin give bob") offers nothing and Enter sends it.
inline std::vector<std::size_t> rankCommandMatches(std::string_view typed,
                                                   const std::vector<std::string>& commands) {
    const std::string needle = normalizedCommandText(typed);
    const std::size_t cut = needle.rfind(' ');
    const std::string head = cut == std::string::npos ? std::string() : needle.substr(0, cut + 1);
    const std::string word = cut == std::string::npos ? needle : needle.substr(cut + 1);
    // A top-level word is "/biom": its slash is not something to look for.
    const std::string bare = (!word.empty() && word[0] == '/') ? word.substr(1) : word;

    std::vector<std::size_t> exact, prefix, contains, near;
    for (std::size_t i = 0; i < commands.size(); ++i) {
        const std::string name = normalizedCommandText(commands[i]);
        if (name == needle) {
            exact.push_back(i);
            continue;
        }
        if (name.size() > needle.size() && name.compare(0, needle.size(), needle) == 0) {
            prefix.push_back(i);
            continue;
        }
        // The rest is about the word being typed, among commands at its level.
        if (name.compare(0, head.size(), head) != 0) continue;
        std::string rest = name.substr(head.size());
        if (head.empty() && !rest.empty() && rest[0] == '/') rest.erase(0, 1);
        // Against the next word only: at the top level every "/admin ..."
        // row would otherwise contain whatever was typed after "/admin".
        const std::string next = rest.substr(0, rest.find(' '));
        if (bare.size() >= 2 && next.find(bare) != std::string::npos) {
            contains.push_back(i);
            continue;
        }
        if (bare.size() >= 3) {
            const int allowed = bare.size() <= 5 ? 1 : 2;
            if (commandEditDistance(bare, next) <= allowed) near.push_back(i);
        }
    }
    std::vector<std::size_t> out = exact;
    out.insert(out.end(), prefix.begin(), prefix.end());
    out.insert(out.end(), contains.begin(), contains.end());
    if (out.empty()) out = near;
    return out;
}

} // namespace flix::ui
