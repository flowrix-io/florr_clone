#include "test.h"

#include "server/session.h"

#include <string>

using namespace flr;

TEST(usernames_accept_reasonable_names_and_reject_the_rest) {
    std::string reason;
    CHECK(validUsername("bob", reason));
    CHECK(validUsername("Player_1", reason));
    CHECK(validUsername("a-very-long-name", reason));

    // Too short, too long.
    CHECK(!validUsername("ab", reason));
    CHECK(!validUsername("abcdefghijklmnopq", reason));
    CHECK(!validUsername("", reason));

    // Must start with a letter, so a name cannot mimic a system line.
    CHECK(!validUsername("1bob", reason));
    CHECK(!validUsername("_bob", reason));
    CHECK(!validUsername("-bob", reason));

    // No spaces, control characters, or anything that would need escaping
    // wherever the name is later rendered.
    CHECK(!validUsername("bo b", reason));
    CHECK(!validUsername("bob\n", reason));
    CHECK(!validUsername("bob<b>", reason));
    CHECK(!validUsername("bob\xC3\xA9", reason));

    // A rejection always says why.
    CHECK(!validUsername("", reason));
    CHECK(!reason.empty());
}

TEST(passwords_have_a_floor_and_a_ceiling) {
    std::string reason;
    CHECK(validPassword("hunter2!", reason));
    CHECK(!validPassword("short", reason));
    CHECK(!validPassword("", reason));
    // The upper bound is not a strength rule: it stops an attacker handing us
    // megabytes to hash for free.
    CHECK(!validPassword(std::string(200, 'x'), reason));
    CHECK(validPassword(std::string(128, 'x'), reason));
}

TEST(chat_is_stripped_of_anything_that_could_forge_a_line) {
    CHECK_EQ(sanitizeChat("hello there"), std::string("hello there"));
    // Newlines would let one message pose as several.
    CHECK_EQ(sanitizeChat("line one\nline two"), std::string("line one line two"));
    CHECK_EQ(sanitizeChat("tab\there"), std::string("tab here"));
    CHECK_EQ(sanitizeChat(std::string("null\0byte", 9)), std::string("nullbyte"));

    // Whitespace-only messages are dropped rather than shown as blanks.
    CHECK_EQ(sanitizeChat("     "), std::string());
    CHECK_EQ(sanitizeChat(""), std::string());
    CHECK_EQ(sanitizeChat("  padded  "), std::string("padded"));

    // Length is capped so one message cannot fill the chat panel.
    const std::string huge(5000, 'x');
    CHECK(sanitizeChat(huge).size() <= std::size_t(200));

    // UTF-8 passes through untouched.
    CHECK_EQ(sanitizeChat("caf\xC3\xA9"), std::string("caf\xC3\xA9"));
}

TEST(allowances_are_spent_and_refill_over_time) {
    double allowance = 2.0;
    CHECK(spend(allowance));
    CHECK(spend(allowance));
    // Exhausted: the next attempt is refused rather than going negative.
    CHECK(!spend(allowance));
    CHECK(allowance >= 0.0);

    Session session;
    session.chatAllowance = 0;
    session.loginAttemptsAllowed = 0;
    session.inputAllowance = 0;
    session.lastRefillMillis = 0;

    // The first call only establishes the baseline; it must not hand out a
    // full refill for time before the session existed.
    refillAllowances(session, 100000);
    CHECK_NEAR(session.chatAllowance, 0.0, 1e-9);

    refillAllowances(session, 100000 + 4000);   // four seconds later
    CHECK(session.chatAllowance > 0.0);
    CHECK(session.loginAttemptsAllowed > 0.0);
    CHECK(session.inputAllowance > 0.0);
}

TEST(allowances_are_capped_so_idling_does_not_bank_a_flood) {
    Session session;
    session.chatAllowance = 0;
    session.lastRefillMillis = 1000;
    // An hour of silence must not buy an hour's worth of messages at once.
    refillAllowances(session, 1000 + 3600000);
    CHECK(session.chatAllowance <= 4.0 + 1e-9);
    CHECK(session.inputAllowance <= 60.0 + 1e-9);
    CHECK(session.loginAttemptsAllowed <= 5.0 + 1e-9);
}

TEST(session_stages_gate_what_is_allowed) {
    Session session;
    // A brand new connection has neither an account nor a body.
    CHECK_EQ(static_cast<int>(session.stage), static_cast<int>(SessionStage::Greeting));
    CHECK(!session.authenticated());
    CHECK(!session.playing());

    session.stage = SessionStage::Authenticated;
    CHECK(session.authenticated());
    // Authenticated is not playing: an account without a body is the lobby.
    CHECK(!session.playing());

    session.stage = SessionStage::Playing;
    // Playing still requires an actual entity; the stage alone is not enough,
    // which is what stops a half-finished join from being treated as live.
    CHECK(!session.playing());
    session.entity = makeEntity(3, 0);
    CHECK(session.playing());
}
