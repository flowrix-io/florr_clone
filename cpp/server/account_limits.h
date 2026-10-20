#pragma once
// Account creation and login abuse limits.
//
// Someone spam-created over 9000 accounts against the production browser
// server, which had no limit of any kind on account creation. This is the
// defence it was given, and since guest accounts it is also what every first
// visit passes through -- so it has two jobs that pull against each other:
// stop a source that is making accounts nobody plays, and never stand in the
// way of real players, including hundreds of them behind one school's NAT or
// one mobile carrier's CGNAT address.
//
// The per-session budget in session.h does NOT cover this. A session is a
// socket, and a socket is free: reconnecting hands the client a brand-new
// allowance. These limits are keyed on the client's ADDRESS instead, and
// outlive any one connection.
//
// The address is the one the proxies in front of the server vouch for, not the
// TCP peer -- on prod every WebSocket arrives from nginx on loopback, often by
// way of Cloudflare, so the peer alone made the whole internet one address.
// See clientAddress().
//
// Four layers:
//   * STANDING. An address earns its allowance: every account it created in
//     the last 30 days that went on to be PLAYED raises its burst and refill
//     rate and its daily idle cap. A network full of real players scales up;
//     a source whose accounts never play stays at the base rate. Measured
//     from the database (AddressStanding), so a restart forgets nothing.
//   * A per-address token bucket sized by that standing.
//   * A per-address daily cap on IDLE accounts -- made in the last 24h and
//     never played. Played accounts do not count against it.
//   * A global bucket, keyed on nothing the client controls, for addresses
//     with NO standing: the backstop against a flood spread over many fresh
//     addresses. An address in good standing never waits on it, so such a
//     flood cannot lock out the networks real players are already on.
// And one escalation: an address refused faster than a person could ask --
// a script hammering the endpoint -- is sent to the penalty box, refused
// outright without a database lookup for kBlockMillis. It is a RATE test, so
// a crowd of people behind one NAT, each refused once, never trips it.

#include <cstddef>
#include <cstdint>
#include <functional>
#include <string>
#include <unordered_map>

#include "shared/net/forwarded.h"

namespace flix {

// -- per address --------------------------------------------------------------

/// What an address with no standing may do: a few back-to-back, then one
/// every two minutes. A family, a small office, a LAN party starting up.
inline constexpr double kRegisterBurst = 5;
inline constexpr double kRegisterRefillPerSecond = 1.0 / 120.0;

/// What standing buys. Each played account from the address adds one to the
/// burst and one base refill's worth to the rate, up to these ceilings -- so
/// a school whose students actually play is never queued behind a two-minute
/// drip, and no address, however good its record, can mint accounts faster
/// than one every five seconds.
inline constexpr double kRegisterBurstMax = 100;
inline constexpr double kRegisterRefillMaxPerSecond = 1.0 / 5.0;

/// Idle accounts -- made in the last 24h and never played -- an address may
/// have before it is refused: a base, plus one for every played account in
/// its standing, up to a ceiling. A spam source's accounts are all idle; a
/// real network's mostly are not. It grows one-for-one like the burst, so a
/// network's burst is never cut short by its idle cap: a class signing up at
/// once is idle for the few minutes before it starts playing.
inline constexpr int kIdlePerAddressDaily = 20;
inline constexpr int kIdlePerAddressDailyMax = 1000;
inline constexpr std::int64_t kIdleWindowMillis = 24LL * 60 * 60 * 1000;

/// How far back an address's played accounts count toward its standing.
inline constexpr std::int64_t kStandingWindowMillis = 30LL * 24 * 60 * 60 * 1000;
/// How often an address's standing is measured again. The measure is cheap
/// (Database::creatorStanding walks one address's own recent accounts), but a
/// flood should not be able to ask for it per packet either.
inline constexpr double kStandingRefreshMillis = 60000;

// -- the penalty box ------------------------------------------------------------

/// The box is about RATE, not about how many people were turned away. Each
/// refused attempt is a strike and strikes drain at kStrikeDrainPerSecond, so
/// only an address refused faster than that, for a while, fills up. Five a
/// second is well past what people do: thirty of them behind one school's
/// NAT, every one refused and refreshing every ten seconds, is three a second,
/// and drains as fast as it adds. A script hammering at twenty a second fills
/// the box in under four seconds. The limit also grows with the address's
/// standing, one strike per played account.
inline constexpr double kStrikeLimit = 50;
inline constexpr double kStrikeDrainPerSecond = 5;
/// How long a boxed address is refused account creation, without its standing
/// even being looked up. Short, because a NAT can hold a bad actor and a lot
/// of innocent people at once. Logins are never blocked: an address full of
/// existing players must not lose them for one script behind the same NAT.
inline constexpr double kBlockMillis = 10.0 * 60 * 1000;

// -- global -------------------------------------------------------------------

/// Server-wide ceiling for addresses with no standing: a burst, then one
/// account every six seconds.
inline constexpr double kGlobalRegisterBurst = 100;
inline constexpr double kGlobalRegisterRefillPerSecond = 1.0 / 6.0;

// -- logins -------------------------------------------------------------------

/// Login attempts per address: room for typos, then one every six seconds. A
/// success hands its attempt back, so only wrong passwords are counted.
inline constexpr double kLoginBurst = 10;
inline constexpr double kLoginRefillPerSecond = 1.0 / 6.0;

/// At most one refusal line per this long -- see AccountLimiter::refusalLogLine.
inline constexpr double kRefusalLogIntervalMillis = 10000;

/// Most addresses tracked at once. A flood from many sources must not turn the
/// defence into the memory exhaustion it is defending against.
inline constexpr std::size_t kMaxTrackedAddresses = 20000;

/// Whether these limits are ENFORCED at all.
///
/// A DEVELOPMENT build does not enforce them. Every limit here is keyed on the
/// address, and everything that talks to a dev server comes from one: the
/// fifth headless login of an afternoon is indistinguishable from the fifth of
/// an attack, and a screenshot rig cannot wait out a refill. A RELEASE build
/// always enforces -- this is the defence a nine-thousand account spam run
/// bought (see the header note), so the switch is a compile definition set
/// only by the dev flavour (cpp/CMakeLists.txt) and there is no way to ask a
/// shipping server to go without it.
#ifdef FLIX_DEV_BUILD
inline constexpr bool kAccountLimitsEnforcedByDefault = false;
#else
inline constexpr bool kAccountLimitsEnforcedByDefault = true;
#endif

/// Which limit refused an attempt.
enum class LimitScope { None, Address, Daily, Global, Blocked };

struct LimitVerdict {
    bool allowed = true;
    /// Seconds until one more attempt would be granted, for the player-facing text.
    int retryAfterSeconds = 0;
    LimitScope scope = LimitScope::None;
    /// Player-facing reason. Deliberately vague about which limit tripped.
    std::string message;
    /// True on the one refusal that sent the address to the penalty box, so
    /// the caller can log the moment it happened.
    bool newlyBlocked = false;
};

/// What the database says one address's accounts have done, which is what
/// its allowance is sized from.
struct AddressStanding {
    /// Accounts it created in the last kIdleWindowMillis that have not been
    /// played.
    int idleToday = 0;
    /// Accounts it created in the last kStandingWindowMillis that have.
    int played = 0;
};

/// Where a connection really comes from, as a bare address (no port): the
/// TCP peer, unless the peer is a proxy this server trusts to say.
///
/// Trusted proxies are loopback -- nginx on the same box -- and Cloudflare's
/// published edge ranges. Anyone else's forwarding headers are ignored, so a
/// client that connects straight to the game port cannot name itself. Behind
/// a trusted peer the hop list is walked from the RIGHT, the end proxies
/// append to: a Cloudflare hop is answered by `CF-Connecting-IP`, which
/// Cloudflare overwrites; any other trusted hop is stepped over; the first
/// address that is not a trusted proxy is the client. Whatever a client wrote
/// at the left of `X-Forwarded-For` is never reached.
///
/// From loopback, nginx may be setting `X-Real-IP`, `X-Forwarded-For`, or
/// both, and a header it does not set passes through from the client. So
/// when both arrive and disagree about the hop nginx saw, one of them is
/// forged and neither is believed: the answer is the peer itself, which puts
/// the request in loopback's own bucket rather than in one a client chose.
/// With both set (the usual `proxy_set_header` pair), they always agree.
std::string clientAddress(const std::string& peer, const net::ForwardedHeaders& headers);

/// Whether `address` (bare, no port) is in one of Cloudflare's published edge
/// ranges (https://www.cloudflare.com/ips/).
bool isCloudflareAddress(const std::string& address);

/// The key an address is limited under.
///
/// Takes a bare address or the transport's `host:port` peer string, drops the
/// port, and folds IPv4-mapped IPv6 back to the IPv4 it carries so one client
/// gets one key however its address is spelled. IPv6 keys on the /64 prefix:
/// a residential allocation is 2^64 addresses, so limiting the full address is
/// no limit.
std::string addressKey(const std::string& peer);

class AccountLimiter {
public:
    /// Says once, on stderr, when this build is not enforcing anything.
    AccountLimiter();

    /// Whether a spend costs anything. False in a development build; a test
    /// that exercises the limits themselves turns it back on, which is also
    /// what makes those tests say out loud that they are about enforcement.
    bool enforced() const { return enforced_; }
    void setEnforced(bool on) { enforced_ = on; }

    /// Spend one account creation's budget -- a registration or a guest.
    ///
    /// `standing` measures the address from the database. It is asked at most
    /// once per kStandingRefreshMillis per address, never for an address in
    /// the penalty box, and its answer is kept in between -- with each account
    /// allowed here counted as one more idle one straight away, so a burst
    /// cannot outrun the cap between two measures.
    ///
    /// Nothing is consumed unless every limit agrees. A failed attempt (name
    /// taken, weak password) still costs its token: otherwise probing which
    /// names exist is free.
    LimitVerdict spendRegistration(const std::string& key,
                                   const std::function<AddressStanding()>& standing,
                                   double nowMillis);

    /// Spend one login attempt's budget. A password guess costs the guesser
    /// nothing and costs this server a bcrypt verify.
    LimitVerdict spendLoginAttempt(const std::string& key, double nowMillis);

    /// Hand back a login token after the credentials turned out to be right,
    /// so a busy legitimate player is never held back by this.
    void refundLoginAttempt(const std::string& key);

    /// A log line for a refused attempt, or empty when one was written too
    /// recently.
    ///
    /// Refusals arrive at exactly the rate of the attack, so logging each one
    /// turns a registration flood into a disk flood. One line per window says
    /// the same thing -- that an attack is happening, and where from -- and
    /// carries how many refusals it stands for.
    std::string refusalLogLine(const std::string& address, LimitScope scope, double nowMillis);

    /// Test hook: forget everything.
    void reset(double nowMillis);

private:
    struct Bucket {
        double tokens = 0;
        double updatedAtMillis = 0;
    };

    /// Everything kept about one address's account creation.
    struct Creator {
        Bucket bucket;
        /// False until the first measure, which is also what fills the bucket:
        /// a new address starts with the burst its standing earns.
        bool measured = false;
        AddressStanding standing;
        double measuredAtMillis = 0;
        double strikes = 0;
        double strikesAtMillis = 0;
        double blockedUntilMillis = 0;
    };

    Bucket& bucketFor(std::unordered_map<std::string, Bucket>& table, const std::string& key,
                      double burst, double refillPerSecond, double nowMillis);
    void sweep(std::unordered_map<std::string, Bucket>& table, double burst,
               double refillPerSecond, double nowMillis);
    void sweepCreators(double nowMillis);
    /// Records a refusal against `creator`, and blocks it when that is one
    /// too many. Returns true when this strike is the one that blocked it.
    bool strike(Creator& creator, double nowMillis);

    bool enforced_ = kAccountLimitsEnforcedByDefault;
    double lastRefusalLogMillis_ = 0;
    int suppressedRefusals_ = 0;

    std::unordered_map<std::string, Creator> creators_;
    std::unordered_map<std::string, Bucket> loginBuckets_;
    Bucket globalRegister_{kGlobalRegisterBurst, 0};
};

} // namespace flix
