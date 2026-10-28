#pragma once
// Days since the Unix epoch for a proleptic-Gregorian y/m/d, and back again.
// Hinnant's civil-calendar algorithms: every date the server keeps is a UTC
// calendar day -- the daily streak's, a backup's name, an admin's search --
// and going through the C library's time functions would drag in a timezone
// and a locale to answer a question that is pure arithmetic.

#include <cstdint>
#include <cstdio>
#include <string>

namespace flix {

inline std::int64_t daysFromCivil(int y, unsigned m, unsigned d) {
    y -= m <= 2;
    const std::int64_t era = (y >= 0 ? y : y - 399) / 400;
    const auto yoe = static_cast<unsigned>(y - era * 400);
    const unsigned doy = (153 * (m + (m > 2 ? -3 : 9)) + 2) / 5 + d - 1;
    const unsigned doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    return era * 146097 + static_cast<std::int64_t>(doe) - 719468;
}

/// "YYYY-MM-DD".
inline std::string civilFromDays(std::int64_t days) {
    days += 719468;
    const std::int64_t era = (days >= 0 ? days : days - 146096) / 146097;
    const auto doe = static_cast<std::uint64_t>(days - era * 146097);
    const std::uint64_t yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
    const std::int64_t y = static_cast<std::int64_t>(yoe) + era * 400;
    const std::uint64_t doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    const std::uint64_t mp = (5 * doy + 2) / 153;
    const std::uint64_t d = doy - (153 * mp + 2) / 5 + 1;
    const std::uint64_t m = mp + (mp < 10 ? 3 : -9);
    char buffer[16];
    std::snprintf(buffer, sizeof buffer, "%04lld-%02llu-%02llu",
                  static_cast<long long>(y + (m <= 2)),
                  static_cast<unsigned long long>(m), static_cast<unsigned long long>(d));
    return buffer;
}

} // namespace flix
