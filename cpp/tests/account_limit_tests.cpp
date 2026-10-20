#include "test.h"

#include "server/account_limits.h"

#include <functional>
#include <string>

using namespace flix;

/// A database with nothing recorded against the address under test.
static const std::function<AddressStanding()> noStanding = [] { return AddressStanding{}; };

/// An address whose accounts have been played `played` times over.
static std::function<AddressStanding()> standingOf(int played, int idleToday = 0) {
    return [=] { return AddressStanding{idleToday, played}; };
}

/// Counts how often an address's standing is measured.
struct CountingScan {
    int calls = 0;
    AddressStanding operator()() { ++calls; return {}; }
};

/// A limiter that enforces, with every bucket full at `now`. A dev build does
/// not enforce these by default, and this file is precisely the place that is
/// about enforcement.
static AccountLimiter enforcingLimiter(double now) {
    AccountLimiter limiter;
    limiter.setEnforced(true);
    limiter.reset(now);
    return limiter;
}

static net::ForwardedHeaders headers(const std::string& forwardedFor, const std::string& realIp = {},
                                     const std::string& cfConnectingIp = {}) {
    net::ForwardedHeaders h;
    h.forwardedFor = forwardedFor;
    h.realIp = realIp;
    h.cfConnectingIp = cfConnectingIp;
    return h;
}

// ---------------------------------------------------------------------------
// Address keys
// ---------------------------------------------------------------------------

TEST(address_keys_agree_across_every_spelling_of_an_address) {
    // The transport hands over `host:port`; the port is not part of the key.
    CHECK(addressKey("1.2.3.4:51000") == "1.2.3.4");
    CHECK(addressKey("1.2.3.4") == "1.2.3.4");

    // An IPv4 peer on a dual-stack listener arrives mapped, in either spelling.
    CHECK(addressKey("::ffff:1.2.3.4:51000") == "1.2.3.4");
    CHECK(addressKey("0000:0000:0000:0000:0000:ffff:7f00:0001:443") == "127.0.0.1");

    // IPv6 keys on the /64: a residential allocation is 2^64 addresses, so
    // keying the whole address would be no limit at all.
    CHECK(addressKey("2001:db8:abcd:1234:5678:9abc:def0:1:9000") ==
          addressKey("2001:db8:abcd:1234:ffff:ffff:ffff:ffff:9000"));
    CHECK(addressKey("2001:db8:abcd:1234:5678:9abc:def0:1:9000") != addressKey("2001:db8:abcd:9999::1:9000"));

    // Compressed, expanded, bracketed and upper-case spellings of one network
    // are one key -- a forwarding header can carry any of them.
    CHECK(addressKey("2001:0db8::1:9000") == addressKey("2001:db8:0:0:0:0:0:5:9000"));
    CHECK(addressKey("[2001:DB8::1]:443") == addressKey("2001:db8::7"));

    // Nothing usable still produces a stable key rather than an empty one.
    CHECK(addressKey("") == "unknown");
    CHECK(!addressKey("garbage").empty());
}

// ---------------------------------------------------------------------------
// Which address a connection really comes from
// ---------------------------------------------------------------------------

TEST(a_client_that_connects_directly_cannot_name_itself) {
    // Port 3000 is reachable from the internet. Whatever a client writes, a
    // peer that is not a trusted proxy is the client.
    CHECK_EQ(clientAddress("203.0.113.9:51000", headers("1.1.1.1", "1.1.1.1", "1.1.1.1")),
             std::string("203.0.113.9"));
    // Nor does a private-range peer count as a proxy: on a LAN server that is
    // just a player.
    CHECK_EQ(clientAddress("192.168.1.20:4000", headers("8.8.8.8")), std::string("192.168.1.20"));
    // And the native transport, with no request at all, is its peer.
    CHECK_EQ(clientAddress("127.0.0.1:4000", {}), std::string("127.0.0.1"));
}

TEST(nginx_on_loopback_is_believed_whichever_header_it_sets) {
    // `proxy_set_header X-Real-IP $remote_addr;` alone.
    CHECK_EQ(clientAddress("127.0.0.1:40000", headers("", "198.51.100.7")),
             std::string("198.51.100.7"));
    // `proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;` alone,
    // with the client's own forgery at the left, where it is never reached.
    CHECK_EQ(clientAddress("127.0.0.1:40000", headers("6.6.6.6, 198.51.100.7")),
             std::string("198.51.100.7"));
    // The usual pair, agreeing.
    CHECK_EQ(clientAddress("127.0.0.1:40000", headers("6.6.6.6, 198.51.100.7", "198.51.100.7")),
             std::string("198.51.100.7"));
    // A dual-stack listener's mapped spelling of loopback is still loopback.
    CHECK_EQ(clientAddress("::ffff:127.0.0.1:40000", headers("", "198.51.100.7")),
             std::string("198.51.100.7"));
    // Hops written with ports, as some proxies write them.
    CHECK_EQ(clientAddress("127.0.0.1:40000", headers("198.51.100.7:4711")),
             std::string("198.51.100.7"));
}

TEST(two_headers_that_disagree_about_nginxs_hop_are_both_disbelieved) {
    // nginx set only X-Forwarded-For; the client added an X-Real-IP of its
    // choosing. One of the two is forged and nothing says which, so the
    // request stays in loopback's own bucket -- never one the client picked.
    CHECK_EQ(clientAddress("127.0.0.1:40000", headers("198.51.100.7", "9.9.9.9")),
             std::string("127.0.0.1"));
    // The other way round: nginx set only X-Real-IP, the client sent a hop
    // list ending somewhere else.
    CHECK_EQ(clientAddress("127.0.0.1:40000", headers("9.9.9.9", "198.51.100.7")),
             std::string("127.0.0.1"));
    // A hop list that does not parse cannot agree with anything either.
    CHECK_EQ(clientAddress("127.0.0.1:40000", headers("not-an-address", "198.51.100.7")),
             std::string("127.0.0.1"));
}

TEST(behind_cloudflare_the_visitor_is_the_one_cloudflare_names) {
    // Cloudflare -> nginx -> here. nginx's hop is a Cloudflare edge, so the
    // visitor is CF-Connecting-IP, which Cloudflare overwrites.
    CHECK_EQ(clientAddress("127.0.0.1:40000", headers("6.6.6.6, 198.51.100.7, 172.64.10.1",
                                                      "172.64.10.1", "198.51.100.7")),
             std::string("198.51.100.7"));
    // Without CF-Connecting-IP, the entry Cloudflare appended -- the one just
    // left of its own edge -- is the visitor.
    CHECK_EQ(clientAddress("127.0.0.1:40000",
                           headers("6.6.6.6, 198.51.100.7, 172.64.10.1", "172.64.10.1")),
             std::string("198.51.100.7"));
    // Cloudflare straight to the game server, no nginx in between.
    CHECK_EQ(clientAddress("104.16.5.5:443", headers("198.51.100.7", "", "198.51.100.7")),
             std::string("198.51.100.7"));
    // An IPv6 visitor, keyed on its /64 like any other.
    const std::string v6 = clientAddress(
        "127.0.0.1:40000", headers("2606:4700::1", "2606:4700::1", "2001:db8:aa:bb::1"));
    CHECK_EQ(addressKey(v6), addressKey("2001:db8:aa:bb:ffff::2"));
}

TEST(a_forged_cloudflare_header_is_ignored_when_cloudflare_was_not_the_hop) {
    // The DNS-direct hostname reaches nginx without Cloudflare. A client
    // there can send any CF-Connecting-IP it likes; nginx's own hop is the
    // client, which is not a Cloudflare edge, so the header is never read.
    CHECK_EQ(clientAddress("127.0.0.1:40000",
                           headers("203.0.113.9", "203.0.113.9", "1.2.3.4")),
             std::string("203.0.113.9"));
    // Nor can a client make itself look like it came through Cloudflare by
    // writing an edge address into the part of the hop list nginx did not.
    CHECK_EQ(clientAddress("127.0.0.1:40000",
                           headers("1.2.3.4, 172.64.10.1, 203.0.113.9", "203.0.113.9", "1.2.3.4")),
             std::string("203.0.113.9"));
}

TEST(cloudflare_edges_are_recognised_to_the_edge_of_each_range) {
    CHECK(isCloudflareAddress("104.16.0.1"));
    CHECK(isCloudflareAddress("104.23.255.255"));    // 104.16.0.0/13, last address
    CHECK(isCloudflareAddress("104.24.0.0"));          // the next block is Cloudflare's too
    CHECK(!isCloudflareAddress("104.15.255.255"));
    CHECK(isCloudflareAddress("2a06:98c0::1"));
    CHECK(isCloudflareAddress("2a06:98c7:ffff::1"));  // inside the /29
    CHECK(!isCloudflareAddress("2a06:98c8::1"));      // just past it
    CHECK(!isCloudflareAddress("127.0.0.1"));
    CHECK(!isCloudflareAddress("garbage"));
}

// ---------------------------------------------------------------------------
// The limits
// ---------------------------------------------------------------------------

TEST(a_release_build_enforces_the_limits_and_a_dev_build_does_not) {
    // The switch is a compile definition precisely so it cannot be flipped at
    // runtime on a shipping server; this is what says the wiring is intact,
    // in whichever flavour the suite was built.
#ifdef FLIX_DEV_BUILD
    CHECK(!kAccountLimitsEnforcedByDefault);
#else
    CHECK(kAccountLimitsEnforcedByDefault);
#endif
    AccountLimiter fresh;
    CHECK_EQ(fresh.enforced(), kAccountLimitsEnforcedByDefault);

    // And an unenforcing limiter spends nothing: the buckets are untouched, so
    // turning enforcement back on starts from a full allowance rather than
    // from whatever a day of testing had drained.
    AccountLimiter off;
    off.setEnforced(false);
    for (int i = 0; i < kRegisterBurst * 10; ++i) {
        CHECK(off.spendRegistration("1.2.3.4", nullptr, 0).allowed);
        CHECK(off.spendLoginAttempt("1.2.3.4", 0).allowed);
    }
    off.setEnforced(true);
    CHECK(off.spendRegistration("1.2.3.4", nullptr, 0).allowed);
}

TEST(registration_allows_a_burst_then_drips) {
    double now = 1000000;
    AccountLimiter limiter = enforcingLimiter(now);

    for (int i = 0; i < kRegisterBurst; ++i) {
        CHECK(limiter.spendRegistration("9.9.9.9", noStanding, now).allowed);
    }
    const LimitVerdict refused = limiter.spendRegistration("9.9.9.9", noStanding, now);
    CHECK(!refused.allowed);
    CHECK(refused.scope == LimitScope::Address);
    CHECK(refused.retryAfterSeconds > 0);
    CHECK(!refused.message.empty());

    // One address being throttled says nothing about any other.
    CHECK(limiter.spendRegistration("8.8.8.8", noStanding, now).allowed);

    now += 1000.0 / kRegisterRefillPerSecond + 1000;  // one refill buys exactly one more
    CHECK(limiter.spendRegistration("9.9.9.9", noStanding, now).allowed);
    CHECK(!limiter.spendRegistration("9.9.9.9", noStanding, now).allowed);
}

TEST(one_ipv6_allocation_cannot_be_walked_for_more_accounts) {
    const double now = 1000000;
    AccountLimiter limiter = enforcingLimiter(now);

    int allowed = 0;
    for (int i = 0; i < 50; ++i) {
        const std::string peer = "2001:db8:1:2:0:0:0:" + std::to_string(i) + ":9000";
        if (limiter.spendRegistration(addressKey(peer), noStanding, now).allowed) ++allowed;
    }
    CHECK(allowed == static_cast<int>(kRegisterBurst));
}

TEST(a_network_whose_accounts_get_played_is_not_held_to_the_base_rate) {
    // A school: forty accounts made from its one address this month have been
    // played. The next class arriving at once is not queued behind a drip.
    double now = 1000000;
    AccountLimiter limiter = enforcingLimiter(now);

    int allowed = 0;
    for (int i = 0; i < 60; ++i) {
        if (limiter.spendRegistration("203.0.113.1", standingOf(40), now).allowed) ++allowed;
    }
    CHECK_EQ(allowed, static_cast<int>(kRegisterBurst) + 40);

    // And it refills faster -- but never faster than the ceiling, however
    // good the record.
    AccountLimiter big = enforcingLimiter(now);
    for (int i = 0; i < kRegisterBurstMax; ++i) {
        CHECK(big.spendRegistration("198.51.100.1", standingOf(10000), now).allowed);
    }
    now += 1000.0 / kRegisterRefillMaxPerSecond + 1;
    CHECK(big.spendRegistration("198.51.100.1", standingOf(10000), now).allowed);
    CHECK(!big.spendRegistration("198.51.100.1", standingOf(10000), now).allowed);
}

TEST(only_unplayed_accounts_count_against_the_daily_cap) {
    const double now = 1000000;
    AccountLimiter limiter = enforcingLimiter(now);

    // A source whose every account sat unplayed is refused at the cap...
    const LimitVerdict refused = limiter.spendRegistration(
        "7.7.7.7", standingOf(0, kIdlePerAddressDaily), now);
    CHECK(!refused.allowed);
    CHECK(refused.scope == LimitScope::Daily);

    // ...while a network with as many idle accounts, and far more played
    // ones, is still let in: its cap grew with its record.
    CHECK(limiter.spendRegistration("6.6.6.6", standingOf(100, kIdlePerAddressDaily), now).allowed);
}

TEST(a_burst_cannot_outrun_the_daily_cap_between_two_measures) {
    // The standing is measured once a minute. Each account allowed in between
    // is counted as idle straight away, so a source one short of its cap gets
    // exactly one more however fast it asks.
    const double now = 1000000;
    AccountLimiter limiter = enforcingLimiter(now);
    const auto oneShort = standingOf(0, kIdlePerAddressDaily - 1);
    CHECK(limiter.spendRegistration("7.7.7.8", oneShort, now).allowed);
    const LimitVerdict next = limiter.spendRegistration("7.7.7.8", oneShort, now);
    CHECK(!next.allowed);
    CHECK(next.scope == LimitScope::Daily);
}

TEST(the_global_ceiling_holds_when_every_request_claims_a_new_address) {
    // The attack the global bucket exists for: 9000 accounts, one per source.
    const double now = 1000000;
    AccountLimiter limiter = enforcingLimiter(now);

    int allowed = 0;
    for (int i = 0; i < 9000; ++i) {
        const std::string peer = "10.0." + std::to_string((i >> 8) & 255) + "." +
                                 std::to_string(i & 255) + ":9000";
        if (limiter.spendRegistration(addressKey(peer), noStanding, now).allowed) ++allowed;
    }
    CHECK(allowed == static_cast<int>(kGlobalRegisterBurst));

    // ...and the networks real players are already on are not locked out by
    // it: an address in good standing never waits on the global bucket.
    CHECK(limiter.spendRegistration("203.0.113.50", standingOf(3), now).allowed);
    const LimitVerdict fresh = limiter.spendRegistration("203.0.113.51", noStanding, now);
    CHECK(!fresh.allowed);
    CHECK(fresh.scope == LimitScope::Global);
}

TEST(an_address_that_keeps_asking_after_refusals_is_sent_to_the_penalty_box) {
    double now = 1000000;
    AccountLimiter limiter = enforcingLimiter(now);
    CountingScan scan;
    const std::function<AddressStanding()> counted = [&] { return scan(); };

    // A script firing as fast as it can -- all in one instant, so no strike
    // has time to drain and the count is exact.
    int blockedAt = -1;
    for (int i = 0; i < 200; ++i) {
        const LimitVerdict verdict = limiter.spendRegistration("4.4.4.4", counted, now);
        if (verdict.newlyBlocked) {
            CHECK(blockedAt < 0);   // said once, on the refusal that did it
            blockedAt = i;
        }
    }
    // The burst, then kStrikeLimit refusals, then the box.
    CHECK_EQ(blockedAt, static_cast<int>(kRegisterBurst + kStrikeLimit) - 1);

    // In the box: refused without its standing being measured again.
    const int scansBefore = scan.calls;
    const LimitVerdict boxed = limiter.spendRegistration("4.4.4.4", counted, now);
    CHECK(!boxed.allowed);
    CHECK(boxed.scope == LimitScope::Blocked);
    CHECK(boxed.retryAfterSeconds > 0);
    CHECK_EQ(scan.calls, scansBefore);

    // Nobody else is: the box is one address.
    CHECK(limiter.spendRegistration("4.4.4.5", noStanding, now).allowed);
    // Logins are not blocked -- an address full of existing players keeps them.
    CHECK(limiter.spendLoginAttempt("4.4.4.4", now).allowed);

    // And it ends.
    now += kBlockMillis + 1;
    CHECK(limiter.spendRegistration("4.4.4.4", counted, now).allowed);
}

TEST(a_crowd_behind_one_address_refreshing_at_human_speed_is_never_boxed) {
    // A school with no record yet: the burst goes to the first few, and the
    // rest -- thirty people, each refreshing the refused page every ten
    // seconds, three a second between them -- are refused for a while.
    // Refused, but never boxed, for as long as they keep at it: the moment the
    // bucket refills, the next of them is let in.
    double now = 1000000;
    AccountLimiter limiter = enforcingLimiter(now);
    for (int i = 0; i < kRegisterBurst; ++i) limiter.spendRegistration("5.6.7.8", noStanding, now);

    int letIn = 0;
    for (int i = 0; i < 3 * 600; ++i) {   // ten minutes of it
        const LimitVerdict verdict = limiter.spendRegistration("5.6.7.8", noStanding, now);
        CHECK(verdict.scope != LimitScope::Blocked);
        CHECK(!verdict.newlyBlocked);
        if (verdict.allowed) ++letIn;
        now += 1000.0 / 3.0;
    }
    CHECK(letIn >= 4);   // one per refill, as the drip promises
}

TEST(standing_is_measured_once_a_window_not_once_a_request) {
    // The measure walks the address's recent accounts. Cheap, but a flood
    // must not be able to ask for it per packet.
    double now = 1000000;
    AccountLimiter limiter = enforcingLimiter(now);

    CountingScan scan;
    const std::function<AddressStanding()> counted = [&] { return scan(); };
    for (int i = 0; i < 10; ++i) limiter.spendRegistration("4.4.4.6", counted, now);
    CHECK_EQ(scan.calls, 1);

    now += kStandingRefreshMillis;
    limiter.spendRegistration("4.4.4.6", counted, now);
    CHECK_EQ(scan.calls, 2);
}

TEST(login_attempts_are_budgeted_and_a_success_hands_its_token_back) {
    const double now = 1000000;
    AccountLimiter limiter = enforcingLimiter(now);

    int allowed = 0;
    for (int i = 0; i < 20; ++i) {
        if (limiter.spendLoginAttempt("5.5.5.5", now).allowed) ++allowed;
    }
    CHECK(allowed == static_cast<int>(kLoginBurst));

    limiter.refundLoginAttempt("5.5.5.5");
    CHECK(limiter.spendLoginAttempt("5.5.5.5", now).allowed);
    CHECK(!limiter.spendLoginAttempt("5.5.5.5", now).allowed);
}

TEST(refusal_logging_is_throttled_so_a_flood_is_not_also_a_log_flood) {
    double now = 1000000;
    AccountLimiter limiter = enforcingLimiter(now);

    const std::string first = limiter.refusalLogLine("1.2.3.4", LimitScope::Address, now);
    CHECK(!first.empty());
    CHECK(first.find("1.2.3.4") != std::string::npos);

    for (int i = 0; i < 500; ++i) {
        CHECK(limiter.refusalLogLine("1.2.3.4", LimitScope::Address, now).empty());
    }

    now += kRefusalLogIntervalMillis + 1;
    const std::string next = limiter.refusalLogLine("1.2.3.4", LimitScope::Blocked, now);
    CHECK(!next.empty());
    // The line stands for everything it swallowed, so the log still shows scale.
    CHECK(next.find("+500 more") != std::string::npos);
    CHECK(next.find("blocked") != std::string::npos);
}
