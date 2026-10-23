#pragma once
// What the content and map loaders say about what they read: each map's
// summary, and every value they corrected, ignored or could not place.
//
// A development build prints all of it. A release build -- what dist/ ships
// and prod runs -- prints none of it. Prod's start-up wrote a hundred-odd of
// these lines, most of them to stderr, and they are the same at every start,
// so the error log read as a wall of map notes with the server's real errors
// somewhere under it. Nothing is lost: the content is embedded, and a dev
// build of the same data says every line of it. A compile definition, as for
// the account limits and the input guard (cpp/CMakeLists.txt).
//
// Only what a loader RECOVERS from goes through here. A file that will not
// load fails the load, and the caller prints that in every build.

#include <cstdarg>
#include <cstdio>

namespace flix {

#ifdef FLIX_DEV_BUILD
inline constexpr bool kContentReports = true;
#else
inline constexpr bool kContentReports = false;
#endif

/// What the content resolved to, on stdout.
[[gnu::format(printf, 1, 2)]] inline void contentNote(const char* format, ...) {
    if (!kContentReports) return;
    va_list args;
    va_start(args, format);
    std::vfprintf(stdout, format, args);
    va_end(args);
}

/// Something wrong with the content that the load worked around, on stderr.
[[gnu::format(printf, 1, 2)]] inline void contentWarning(const char* format, ...) {
    if (!kContentReports) return;
    va_list args;
    va_start(args, format);
    std::vfprintf(stderr, format, args);
    va_end(args);
}

} // namespace flix
