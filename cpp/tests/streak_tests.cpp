#include "test.h"

#include <cstdio>
#include <string>
#include <unistd.h>

#include "server/db.h"
#include "server/session.h"

using namespace flix;

// The daily-login streak, which is the only thing on the title screen that
// depends on the calendar. Every case here drives the clock rather than the
// wall, because "what happens tomorrow" is the whole question.

namespace {

/// The database's clock hook takes a plain function pointer, so the time the
/// tests want lives here rather than in a capture.
std::int64_t gNowMillis = 0;
std::int64_t testClock() { return gNowMillis; }

constexpr std::int64_t kDay = 86400000;

/// A database on a scratch path with one account, wired to `testClock`.
struct Fixture {
    Database db;
    std::string path;
    std::string userId;

    Fixture() {
        path = std::string("/tmp/florr-streak-") + std::to_string(::getpid()) + ".json";
        std::remove(path.c_str());
        std::string error;
        db.load(path, error);
        db.setClock(&testClock);
        db.setPasswordCost(4);
        const CreateResult created = db.createUser("streaker", "password7");
        if (created.ok() && created.account) userId = created.account->id;
    }
    ~Fixture() { std::remove(path.c_str()); }
};

} // namespace

TEST(a_first_login_claims_day_one_and_pays_one_star) {
    gNowMillis = 20000 * kDay + 3600000;   // some day, an hour past midnight
    Fixture f;
    if (f.userId.empty()) { CHECK(false); return; }

    const DailyStreakResult first = f.db.processDailyStreak(f.userId);
    CHECK(first.newDay);
    CHECK_EQ(first.streak, 1);
    CHECK_EQ(first.starsAwarded, 1);
    CHECK_EQ(f.db.progress(f.userId).stars, 1);
    // The countdowns are anchored to midnight, not to the moment of the claim.
    CHECK_EQ(first.nextClaimAtMillis, 20001 * kDay);
    CHECK_EQ(first.streakExpiresAtMillis, 20002 * kDay);
}

TEST(a_second_login_the_same_day_pays_nothing) {
    gNowMillis = 20000 * kDay;
    Fixture f;
    if (f.userId.empty()) { CHECK(false); return; }

    f.db.processDailyStreak(f.userId);
    gNowMillis = 20000 * kDay + kDay - 1;   // one millisecond before midnight
    const DailyStreakResult again = f.db.processDailyStreak(f.userId);
    CHECK(!again.newDay);
    CHECK_EQ(again.streak, 1);
    CHECK_EQ(again.starsAwarded, 0);
    CHECK_EQ(f.db.progress(f.userId).stars, 1);
}

TEST(consecutive_days_climb_the_streak_and_the_reward) {
    gNowMillis = 20000 * kDay;
    Fixture f;
    if (f.userId.empty()) { CHECK(false); return; }

    int expectedStars = 0;
    for (int day = 0; day < 6; ++day) {
        gNowMillis = (20000 + day) * kDay + 60000;
        const DailyStreakResult result = f.db.processDailyStreak(f.userId);
        CHECK(result.newDay);
        CHECK_EQ(result.streak, day + 1);
        // The reward cycles 1..5 and starts again, so the sixth day pays one.
        CHECK_EQ(result.starsAwarded, (day % 5) + 1);
        expectedStars += result.starsAwarded;
    }
    CHECK_EQ(f.db.progress(f.userId).stars, expectedStars);
}

TEST(a_missed_day_resets_the_streak_to_one) {
    gNowMillis = 20000 * kDay;
    Fixture f;
    if (f.userId.empty()) { CHECK(false); return; }

    f.db.processDailyStreak(f.userId);
    gNowMillis = 20001 * kDay;
    CHECK_EQ(f.db.processDailyStreak(f.userId).streak, 2);

    // Skipping 20002 entirely breaks the run.
    gNowMillis = 20003 * kDay;
    const DailyStreakResult broken = f.db.processDailyStreak(f.userId);
    CHECK(broken.newDay);
    CHECK_EQ(broken.streak, 1);
    CHECK_EQ(broken.starsAwarded, 1);
}

TEST(an_unreadable_streak_date_restarts_rather_than_crashing) {
    gNowMillis = 20000 * kDay;
    Fixture f;
    if (f.userId.empty()) { CHECK(false); return; }

    PlayerRecord& record = f.db.progress(f.userId);
    record.dailyStreak = 9;
    record.lastStreakDate = "not-a-date";
    const DailyStreakResult result = f.db.processDailyStreak(f.userId);
    CHECK_EQ(result.streak, 1);
    CHECK_EQ(result.starsAwarded, 1);
    CHECK_EQ(f.db.progress(f.userId).lastStreakDate, std::string("2024-10-04"));
}

TEST(the_stored_date_is_the_utc_calendar_day) {
    // 1970-01-01 is day zero; 20000 days later is 2024-10-04.
    gNowMillis = 0;
    Fixture f;
    if (f.userId.empty()) { CHECK(false); return; }
    f.db.processDailyStreak(f.userId);
    CHECK_EQ(f.db.progress(f.userId).lastStreakDate, std::string("1970-01-01"));

    gNowMillis = 19813 * kDay;   // the far side of a leap year's February
    f.db.progress(f.userId).lastStreakDate.clear();
    f.db.processDailyStreak(f.userId);
    CHECK_EQ(f.db.progress(f.userId).lastStreakDate, std::string("2024-03-31"));
}

// ---------------------------------------------------------------------------
// The flower's name
// ---------------------------------------------------------------------------

TEST(a_flower_name_is_trimmed_capped_and_never_empty) {
    CHECK_EQ(sanitizePlayerName("Rose"), std::string("Rose"));
    CHECK_EQ(sanitizePlayerName("   "), std::string("Unnamed"));
    CHECK_EQ(sanitizePlayerName(""), std::string("Unnamed"));
    CHECK_EQ(sanitizePlayerName("  padded  "), std::string("padded"));
    // Twenty characters, counted the way the reference counts them.
    CHECK_EQ(sanitizePlayerName("012345678901234567890123"),
             std::string("01234567890123456789"));
    // Control bytes cannot forge a second nameplate line.
    CHECK_EQ(sanitizePlayerName("a\nb\tc"), std::string("abc"));
}

TEST(a_flower_name_cut_at_the_cap_stays_valid_utf8) {
    // Nineteen ASCII then a three-byte character: the cap lands inside it, and
    // half a sequence on the wire is worse than a shorter name.
    const std::string cut = sanitizePlayerName("0123456789012345678\xe2\x98\x85");
    CHECK_EQ(cut, std::string("0123456789012345678"));

    // Eighteen ASCII leaves no room either -- 18 + 3 is 21.
    CHECK_EQ(sanitizePlayerName("012345678901234567\xe2\x98\x85"),
             std::string("012345678901234567"));
    // Seventeen does: 17 + 3 is 20, so the star survives whole.
    CHECK_EQ(sanitizePlayerName("01234567890123456\xe2\x98\x85"),
             std::string("01234567890123456\xe2\x98\x85"));
}
