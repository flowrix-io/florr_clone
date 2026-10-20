#include "server/account_limits.h"

#include <algorithm>
#include <cmath>
#include <cstdio>
#include <vector>

#include "shared/core/text.h"

namespace flix {

namespace {

bool allDigits(const std::string& text) {
    if (text.empty()) return false;
    for (const char c : text) {
        if (c < '0' || c > '9') return false;
    }
    return true;
}

std::vector<std::string> split(const std::string& text, char sep) {
    std::vector<std::string> parts;
    std::size_t start = 0;
    while (true) {
        const std::size_t at = text.find(sep, start);
        if (at == std::string::npos) { parts.push_back(text.substr(start)); break; }
        parts.push_back(text.substr(start, at - start));
        start = at + 1;
    }
    return parts;
}

/// The four octets of a dotted quad, or false if it is not one.
bool parseIPv4(const std::string& text, int out[4]) {
    const std::vector<std::string> parts = split(text, '.');
    if (parts.size() != 4) return false;
    for (int i = 0; i < 4; ++i) {
        if (!allDigits(parts[i]) || parts[i].size() > 3) return false;
        const int value = std::stoi(parts[i]);
        if (value > 255) return false;
        out[i] = value;
    }
    return true;
}

bool parseHexGroup(const std::string& text, int& out) {
    if (text.empty() || text.size() > 4) return false;
    int value = 0;
    for (const char c : text) {
        int digit;
        if (c >= '0' && c <= '9') digit = c - '0';
        else if (c >= 'a' && c <= 'f') digit = c - 'a' + 10;
        else return false;
        value = value * 16 + digit;
    }
    out = value;
    return true;
}

/// An IPv6 address as its eight 16-bit groups. Handles the `::`-compressed
/// form and a trailing dotted quad (`::ffff:1.2.3.4`), which is how an
/// IPv4 peer on a dual-stack listener is usually spelled. Parsing to numbers
/// rather than comparing text is what makes every spelling agree on one key.
bool expandIPv6(const std::string& input, int out[8]) {
    std::string text = input;
    std::vector<int> embedded;

    const std::size_t lastColon = text.rfind(':');
    if (lastColon != std::string::npos && text.find('.', lastColon) != std::string::npos) {
        int octets[4];
        if (!parseIPv4(text.substr(lastColon + 1), octets)) return false;
        embedded = {(octets[0] << 8) | octets[1], (octets[2] << 8) | octets[3]};
        text = text.substr(0, lastColon);
        // `::1.2.3.4` leaves a lone ':' behind; restore the `::` marker.
        if (text == ":") text = "::";
    }

    const std::size_t doubleColon = text.find("::");
    if (doubleColon != std::string::npos && text.find("::", doubleColon + 1) != std::string::npos) {
        return false;  // more than one `::` is not an address
    }

    const std::string headText = doubleColon == std::string::npos ? text : text.substr(0, doubleColon);
    const std::string tailText = doubleColon == std::string::npos ? "" : text.substr(doubleColon + 2);

    std::vector<int> head, tail;
    auto collect = [](const std::string& part, std::vector<int>& into) {
        if (part.empty()) return true;
        for (const std::string& group : split(part, ':')) {
            int value = 0;
            if (!parseHexGroup(group, value)) return false;
            into.push_back(value);
        }
        return true;
    };
    if (!collect(headText, head) || !collect(tailText, tail)) return false;

    const std::size_t explicitGroups = head.size() + tail.size() + embedded.size();
    if (explicitGroups > 8) return false;
    if (doubleColon == std::string::npos && explicitGroups != 8) return false;

    std::vector<int> groups = head;
    if (doubleColon != std::string::npos) groups.resize(8 - tail.size() - embedded.size(), 0);
    groups.insert(groups.end(), tail.begin(), tail.end());
    groups.insert(groups.end(), embedded.begin(), embedded.end());
    if (groups.size() != 8) return false;

    for (int i = 0; i < 8; ++i) out[i] = groups[static_cast<std::size_t>(i)];
    return true;
}

std::string hexGroup(int value) {
    static const char kDigits[] = "0123456789abcdef";
    std::string out;
    for (int shift = 12; shift >= 0; shift -= 4) {
        const int digit = (value >> shift) & 0xF;
        if (!out.empty() || digit != 0 || shift == 0) out.push_back(kDigits[digit]);
    }
    return out;
}

std::string joinOctets(int a, int b, int c, int d) {
    return std::to_string(a) + "." + std::to_string(b) + "." + std::to_string(c) + "." +
           std::to_string(d);
}

LimitVerdict denied(LimitScope scope, int retryAfterSeconds, const char* message) {
    LimitVerdict verdict;
    verdict.allowed = false;
    verdict.scope = scope;
    verdict.retryAfterSeconds = retryAfterSeconds;
    verdict.message = message;
    return verdict;
}

/// Seconds until a bucket holds a whole token again.
int waitSeconds(double tokens, double refillPerSecond) {
    if (tokens >= 1) return 0;
    return static_cast<int>(std::ceil((1.0 - tokens) / refillPerSecond));
}

/// What an address's standing buys it. See the constants in the header.
double burstFor(const AddressStanding& standing) {
    return std::min(kRegisterBurstMax, kRegisterBurst + standing.played);
}
double refillFor(const AddressStanding& standing) {
    return std::min(kRegisterRefillMaxPerSecond, kRegisterRefillPerSecond * (1 + standing.played));
}
int idleCapFor(const AddressStanding& standing) {
    return std::min(kIdlePerAddressDailyMax, kIdlePerAddressDaily + standing.played);
}
double strikeLimitFor(const AddressStanding& standing) {
    return kStrikeLimit + standing.played;
}


/// The host part of a peer string or a forwarding header entry: lower-cased,
/// trimmed, with any port and brackets taken off. `[v6]:port` and `v4:port`
/// are both spellings a proxy may use in X-Forwarded-For.
std::string peerHost(const std::string& peer) {
    std::string host = lowerCase(trimmed(peer));
    if (!host.empty() && host.front() == '[') {
        const std::size_t close = host.find(']');
        return close == std::string::npos ? host.substr(1) : host.substr(1, close - 1);
    }
    // The transport formats a peer as `host:port`, unbracketed, so the port is
    // whatever follows the LAST colon -- an IPv6 host is full of the others.
    const std::size_t lastColon = host.rfind(':');
    if (lastColon != std::string::npos && allDigits(host.substr(lastColon + 1))) {
        // ...unless the whole thing is a bare IPv6 address, where the trailing
        // group is a group and not a port. Only trim when what remains is still
        // an address in its own right, which `2001:db8:` (from `2001:db8::1`)
        // is not.
        const std::string head = host.substr(0, lastColon);
        int probe[8];
        int octets[4];
        const bool stillAnAddress = !head.empty() && head.back() != ':' &&
                                    (parseIPv4(head, octets) || expandIPv6(head, probe) ||
                                     head.find(':') == std::string::npos);
        if (stillAnAddress) host = head;
    }
    return host;
}

/// One parsed address. IPv4-mapped IPv6 is folded to IPv4 on the way in, so
/// a client has one identity however its address is spelled.
struct Address {
    bool v4 = false;
    int octets[4] = {0, 0, 0, 0};
    int groups[8] = {0, 0, 0, 0, 0, 0, 0, 0};
};

bool parseAddress(const std::string& text, Address& out) {
    const std::string host = peerHost(text);
    if (host.empty()) return false;
    out = Address{};
    if (parseIPv4(host, out.octets)) {
        out.v4 = true;
        return true;
    }
    if (!expandIPv6(host, out.groups)) return false;
    const bool mapped = out.groups[0] == 0 && out.groups[1] == 0 && out.groups[2] == 0 &&
                        out.groups[3] == 0 && out.groups[4] == 0 && out.groups[5] == 0xffff;
    if (mapped) {
        out.v4 = true;
        out.octets[0] = out.groups[6] >> 8;
        out.octets[1] = out.groups[6] & 0xff;
        out.octets[2] = out.groups[7] >> 8;
        out.octets[3] = out.groups[7] & 0xff;
    }
    return true;
}

/// The address as one spelling: dotted for IPv4, all eight groups for IPv6.
/// Never compressed, so it can be compared as text and taken apart again.
std::string canonical(const Address& address) {
    if (address.v4) {
        return joinOctets(address.octets[0], address.octets[1], address.octets[2],
                          address.octets[3]);
    }
    std::string out;
    for (int i = 0; i < 8; ++i) {
        if (i > 0) out += ':';
        out += hexGroup(address.groups[i]);
    }
    return out;
}

/// A CIDR block, written as Cloudflare publishes it.
struct Block {
    const char* base;
    int prefix;
};

/// https://www.cloudflare.com/ips-v4 and /ips-v6, as published 2026-10-19.
/// They change rarely and are announced well ahead; an edge missing from here
/// only means that edge's visitors share one bucket until it is added.
constexpr Block kCloudflareBlocks[] = {
    {"173.245.48.0", 20}, {"103.21.244.0", 22}, {"103.22.200.0", 22}, {"103.31.4.0", 22},
    {"141.101.64.0", 18}, {"108.162.192.0", 18}, {"190.93.240.0", 20}, {"188.114.96.0", 20},
    {"197.234.240.0", 22}, {"198.41.128.0", 17}, {"162.158.0.0", 15}, {"104.16.0.0", 13},
    {"104.24.0.0", 14}, {"172.64.0.0", 13}, {"131.0.72.0", 22},
    {"2400:cb00::", 32}, {"2606:4700::", 32}, {"2803:f800::", 32}, {"2405:b500::", 32},
    {"2405:8100::", 32}, {"2a06:98c0::", 29}, {"2c0f:f248::", 32},
};

bool inBlock(const Address& address, const Block& block) {
    Address base;
    if (!parseAddress(block.base, base) || base.v4 != address.v4) return false;
    // Compared as bytes, most significant first, for as many bits as the
    // prefix covers.
    int bits = block.prefix;
    const int width = address.v4 ? 4 : 16;
    for (int i = 0; i < width && bits > 0; ++i) {
        const int a = address.v4 ? address.octets[i]
                                 : ((i % 2 == 0) ? address.groups[i / 2] >> 8 : address.groups[i / 2] & 0xff);
        const int b = base.v4 ? base.octets[i]
                              : ((i % 2 == 0) ? base.groups[i / 2] >> 8 : base.groups[i / 2] & 0xff);
        const int take = std::min(bits, 8);
        const int mask = (0xff << (8 - take)) & 0xff;
        if ((a & mask) != (b & mask)) return false;
        bits -= take;
    }
    return true;
}

bool isCloudflare(const Address& address) {
    for (const Block& block : kCloudflareBlocks) {
        if (inBlock(address, block)) return true;
    }
    return false;
}

bool isLoopback(const Address& address) {
    if (address.v4) return address.octets[0] == 127;
    for (int i = 0; i < 7; ++i) {
        if (address.groups[i] != 0) return false;
    }
    return address.groups[7] == 1;
}

/// A proxy whose forwarding headers this server believes: nginx on the same
/// box, or a Cloudflare edge. Deliberately NOT the private ranges -- a LAN
/// player connecting straight to the game port is a client, not a proxy.
bool trustedProxy(const Address& address) { return isLoopback(address) || isCloudflare(address); }

} // namespace

bool isCloudflareAddress(const std::string& address) {
    Address parsed;
    return parseAddress(address, parsed) && isCloudflare(parsed);
}

std::string clientAddress(const std::string& peer, const net::ForwardedHeaders& headers) {
    Address current;
    if (!parseAddress(peer, current)) {
        const std::string host = peerHost(peer);
        return host.empty() ? "unknown" : host;
    }
    // Anyone who is not a trusted proxy is the client, whatever it wrote.
    if (!trustedProxy(current)) return canonical(current);

    std::vector<std::string> chain;
    if (!trimmed(headers.forwardedFor).empty()) chain = split(headers.forwardedFor, ',');

    Address realIp;
    const bool hasRealIp = parseAddress(headers.realIp, realIp);
    if (isLoopback(current) && hasRealIp) {
        // nginx's own hop is the last entry it appended to X-Forwarded-For and
        // the X-Real-IP it set. When both are here they are one address, or
        // one of them came from the client: then neither is believed.
        if (!chain.empty()) {
            Address lastHop;
            if (!parseAddress(chain.back(), lastHop) || canonical(lastHop) != canonical(realIp)) {
                return canonical(current);
            }
        } else {
            chain.push_back(headers.realIp);
        }
    }

    // Right to left: each trusted hop vouches for the one before it.
    for (;;) {
        if (isCloudflare(current)) {
            Address visitor;
            if (parseAddress(headers.cfConnectingIp, visitor)) return canonical(visitor);
        }
        if (chain.empty()) return canonical(current);
        Address next;
        if (!parseAddress(chain.back(), next)) return canonical(current);
        chain.pop_back();
        if (!trustedProxy(next)) return canonical(next);
        current = next;
    }
}

std::string addressKey(const std::string& peer) {
    Address address;
    if (!parseAddress(peer, address)) {
        const std::string host = peerHost(peer);
        return host.empty() ? "unknown" : host;
    }
    if (address.v4) return canonical(address);
    return hexGroup(address.groups[0]) + ":" + hexGroup(address.groups[1]) + ":" +
           hexGroup(address.groups[2]) + ":" + hexGroup(address.groups[3]) + "::/64";
}

void AccountLimiter::sweep(std::unordered_map<std::string, Bucket>& table, double burst,
                           double refillPerSecond, double nowMillis) {
    if (table.size() <= kMaxTrackedAddresses) return;

    // A bucket that has refilled to full is indistinguishable from an address
    // never seen, so forgetting it costs nothing.
    for (auto it = table.begin(); it != table.end();) {
        const double elapsed = (nowMillis - it->second.updatedAtMillis) / 1000.0;
        const double tokens = std::min(burst, it->second.tokens + elapsed * refillPerSecond);
        if (tokens >= burst) it = table.erase(it);
        else ++it;
    }
    if (table.size() <= kMaxTrackedAddresses) return;

    // Still over budget means every tracked address is actively spending: a
    // distributed flood. Drop the least recently seen half rather than grow
    // without bound -- the global bucket is what holds that line anyway.
    std::vector<std::pair<double, std::string>> byAge;
    byAge.reserve(table.size());
    for (const auto& entry : table) byAge.emplace_back(entry.second.updatedAtMillis, entry.first);
    std::sort(byAge.begin(), byAge.end());
    for (std::size_t i = 0; i < byAge.size() / 2; ++i) table.erase(byAge[i].second);
}

AccountLimiter::Bucket& AccountLimiter::bucketFor(std::unordered_map<std::string, Bucket>& table,
                                                  const std::string& key, double burst,
                                                  double refillPerSecond, double nowMillis) {
    auto it = table.find(key);
    if (it == table.end()) {
        sweep(table, burst, refillPerSecond, nowMillis);
        it = table.emplace(key, Bucket{burst, nowMillis}).first;
    }
    Bucket& bucket = it->second;
    const double elapsed = (nowMillis - bucket.updatedAtMillis) / 1000.0;
    if (elapsed > 0) {
        bucket.updatedAtMillis = nowMillis;
        bucket.tokens = std::min(burst, bucket.tokens + elapsed * refillPerSecond);
    }
    return bucket;
}

AccountLimiter::AccountLimiter() {
    if (enforced_) return;
    // Once per process, however many limiters a test builds: a server running
    // with its abuse defences off is something an operator has to be able to
    // see in the log, and a dev build that reached a machine it should not
    // have is worth shouting about.
    static bool announced = false;
    if (announced) return;
    announced = true;
    std::fprintf(stderr,
                 "[ABUSE] development build: account creation and login limits are NOT enforced\n");
}

void AccountLimiter::sweepCreators(double nowMillis) {
    if (creators_.size() <= kMaxTrackedAddresses) return;

    // An address at rest -- bucket full, no strikes left, not blocked -- is
    // one the next request can measure afresh from the database, so
    // forgetting it costs nothing.
    for (auto it = creators_.begin(); it != creators_.end();) {
        const Creator& creator = it->second;
        const double elapsed = (nowMillis - creator.bucket.updatedAtMillis) / 1000.0;
        const double tokens = std::min(burstFor(creator.standing),
                                       creator.bucket.tokens + elapsed * refillFor(creator.standing));
        const double strikesLeft =
            creator.strikes - (nowMillis - creator.strikesAtMillis) / 1000.0 * kStrikeDrainPerSecond;
        const bool atRest = creator.blockedUntilMillis <= nowMillis && strikesLeft <= 0 &&
                            tokens >= burstFor(creator.standing);
        if (atRest) it = creators_.erase(it);
        else ++it;
    }
    if (creators_.size() <= kMaxTrackedAddresses) return;

    // Still over budget means every tracked address is actively spending: a
    // distributed flood. Drop the least recently seen half rather than grow
    // without bound -- blocked addresses last, since forgetting one lets it
    // straight back in, and the global bucket holds the line for the rest.
    std::vector<std::pair<std::pair<bool, double>, std::string>> byAge;
    byAge.reserve(creators_.size());
    for (const auto& entry : creators_) {
        const bool blocked = entry.second.blockedUntilMillis > nowMillis;
        byAge.push_back({{blocked, entry.second.bucket.updatedAtMillis}, entry.first});
    }
    std::sort(byAge.begin(), byAge.end());
    for (std::size_t i = 0; i < byAge.size() / 2; ++i) creators_.erase(byAge[i].second);
}

bool AccountLimiter::strike(Creator& creator, double nowMillis) {
    const double elapsed = (nowMillis - creator.strikesAtMillis) / 1000.0;
    creator.strikes = std::max(0.0, creator.strikes - elapsed * kStrikeDrainPerSecond) + 1.0;
    creator.strikesAtMillis = nowMillis;
    if (creator.strikes < strikeLimitFor(creator.standing)) return false;
    creator.blockedUntilMillis = nowMillis + kBlockMillis;
    creator.strikes = 0;
    return true;
}

LimitVerdict AccountLimiter::spendRegistration(const std::string& key,
                                               const std::function<AddressStanding()>& standing,
                                               double nowMillis) {
    // Nothing is counted, so nothing is refused and no bucket is touched: a
    // dev build that is later switched back on starts from a full allowance
    // rather than from whatever an afternoon of testing had drained.
    if (!enforced_) return LimitVerdict{};

    auto found = creators_.find(key);
    if (found == creators_.end()) {
        sweepCreators(nowMillis);
        found = creators_.emplace(key, Creator{}).first;
    }
    Creator& creator = found->second;

    // The penalty box answers first, and asks the database nothing: whatever
    // an address in it sends costs this server a hash lookup and no more.
    if (creator.blockedUntilMillis > nowMillis) {
        return denied(LimitScope::Blocked,
                      static_cast<int>(std::ceil((creator.blockedUntilMillis - nowMillis) / 1000.0)),
                      "Too many attempts from your network. Please try again later.");
    }

    if (!creator.measured || nowMillis - creator.measuredAtMillis >= kStandingRefreshMillis) {
        const AddressStanding measured = standing ? standing() : AddressStanding{};
        // A new address starts with the burst its record has earned.
        if (!creator.measured) creator.bucket = Bucket{burstFor(measured), nowMillis};
        creator.standing = measured;
        creator.measured = true;
        creator.measuredAtMillis = nowMillis;
    }

    const double burst = burstFor(creator.standing);
    const double refill = refillFor(creator.standing);
    const double elapsed = (nowMillis - creator.bucket.updatedAtMillis) / 1000.0;
    if (elapsed > 0) {
        creator.bucket.updatedAtMillis = nowMillis;
        creator.bucket.tokens += elapsed * refill;
    }
    // Also when standing has fallen since the last measure: a smaller record
    // is a smaller bucket.
    creator.bucket.tokens = std::min(burst, creator.bucket.tokens);

    if (globalRegister_.updatedAtMillis == 0) globalRegister_.updatedAtMillis = nowMillis;
    const double globalElapsed = (nowMillis - globalRegister_.updatedAtMillis) / 1000.0;
    if (globalElapsed > 0) {
        globalRegister_.updatedAtMillis = nowMillis;
        globalRegister_.tokens = std::min(
            kGlobalRegisterBurst, globalRegister_.tokens + globalElapsed * kGlobalRegisterRefillPerSecond);
    }

    // Checked before anything is spent: an attempt one limit refuses must not
    // also burn another's budget. The two that are this address's own doing
    // are strikes; the global one is not -- an address that waited its turn
    // behind somebody else's flood has done nothing wrong.
    if (creator.bucket.tokens < 1) {
        LimitVerdict verdict = denied(LimitScope::Address, waitSeconds(creator.bucket.tokens, refill),
                                      "Too many accounts created from here. Please wait a few minutes.");
        verdict.newlyBlocked = strike(creator, nowMillis);
        return verdict;
    }
    if (creator.standing.idleToday >= idleCapFor(creator.standing)) {
        LimitVerdict verdict =
            denied(LimitScope::Daily, 3600,
                   "This network has made too many accounts nobody has played today. "
                   "Try again later.");
        verdict.newlyBlocked = strike(creator, nowMillis);
        return verdict;
    }
    // An address whose accounts get played has shown it is people; the global
    // ceiling is for everyone who has not shown anything yet.
    const bool vouched = creator.standing.played > 0;
    if (!vouched && globalRegister_.tokens < 1) {
        return denied(LimitScope::Global,
                      waitSeconds(globalRegister_.tokens, kGlobalRegisterRefillPerSecond),
                      "The server is creating accounts as fast as it will right now. Try again shortly.");
    }

    creator.bucket.tokens -= 1;
    if (!vouched) globalRegister_.tokens -= 1;
    // The account about to be made is idle until somebody plays it, and the
    // next measure is up to a minute away.
    creator.standing.idleToday += 1;
    return LimitVerdict{};
}

LimitVerdict AccountLimiter::spendLoginAttempt(const std::string& key, double nowMillis) {
    if (!enforced_) return LimitVerdict{};
    Bucket& bucket = bucketFor(loginBuckets_, key, kLoginBurst, kLoginRefillPerSecond, nowMillis);
    if (bucket.tokens < 1) {
        return denied(LimitScope::Address, waitSeconds(bucket.tokens, kLoginRefillPerSecond),
                      "Too many login attempts. Please wait a moment.");
    }
    bucket.tokens -= 1;
    return LimitVerdict{};
}

void AccountLimiter::refundLoginAttempt(const std::string& key) {
    auto it = loginBuckets_.find(key);
    if (it != loginBuckets_.end()) {
        it->second.tokens = std::min(kLoginBurst, it->second.tokens + 1.0);
    }
}

std::string AccountLimiter::refusalLogLine(const std::string& address, LimitScope scope,
                                           double nowMillis) {
    ++suppressedRefusals_;
    if (lastRefusalLogMillis_ != 0 && nowMillis - lastRefusalLogMillis_ < kRefusalLogIntervalMillis) {
        return {};
    }
    const int suppressed = suppressedRefusals_ - 1;
    lastRefusalLogMillis_ = nowMillis;
    suppressedRefusals_ = 0;

    const char* which = scope == LimitScope::Daily     ? "daily"
                        : scope == LimitScope::Global  ? "global"
                        : scope == LimitScope::Blocked ? "blocked"
                                                       : "address";
    std::string line = std::string("[ABUSE] registration refused (") + which + ") for " + address;
    if (suppressed > 0) {
        line += " (+" + std::to_string(suppressed) + " more since the last line)";
    }
    return line;
}

void AccountLimiter::reset(double nowMillis) {
    creators_.clear();
    loginBuckets_.clear();
    globalRegister_ = Bucket{kGlobalRegisterBurst, nowMillis};
    lastRefusalLogMillis_ = 0;
    suppressedRefusals_ = 0;
}

} // namespace flix
