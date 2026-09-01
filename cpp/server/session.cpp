#include "server/session.h"

#include <algorithm>

namespace flr {

namespace {

/// Allowance refill rates, per second.
constexpr double kLoginRefillPerSecond = 0.2;    // one attempt every 5s
constexpr double kChatRefillPerSecond = 0.5;     // one message every 2s
constexpr double kInputRefillPerSecond = 30.0;   // comfortably above the tick rate

constexpr double kMaxLoginAttempts = 5;
constexpr double kMaxChatAllowance = 4;
constexpr double kMaxInputAllowance = 60;

constexpr std::size_t kMinUsername = 3;
constexpr std::size_t kMaxUsername = 16;
constexpr std::size_t kMinPassword = 6;
constexpr std::size_t kMaxPassword = 128;
constexpr std::size_t kMaxChatLength = 200;

} // namespace

void refillAllowances(Session& session, double nowMillis) {
    if (session.lastRefillMillis == 0) {
        session.lastRefillMillis = nowMillis;
        return;
    }
    const double elapsed = (nowMillis - session.lastRefillMillis) / 1000.0;
    if (elapsed <= 0) return;
    session.lastRefillMillis = nowMillis;

    session.loginAttemptsAllowed =
        std::min(kMaxLoginAttempts, session.loginAttemptsAllowed + elapsed * kLoginRefillPerSecond);
    session.chatAllowance =
        std::min(kMaxChatAllowance, session.chatAllowance + elapsed * kChatRefillPerSecond);
    session.inputAllowance =
        std::min(kMaxInputAllowance, session.inputAllowance + elapsed * kInputRefillPerSecond);
}

bool spend(double& allowance, double cost) {
    if (allowance < cost) return false;
    allowance -= cost;
    return true;
}

bool validUsername(const std::string& name, std::string& reasonOut) {
    if (name.size() < kMinUsername || name.size() > kMaxUsername) {
        reasonOut = "Username must be 3 to 16 characters.";
        return false;
    }
    for (const char c : name) {
        const bool allowed = (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') ||
                             (c >= '0' && c <= '9') || c == '_' || c == '-';
        if (!allowed) {
            reasonOut = "Username may only contain letters, digits, underscore and hyphen.";
            return false;
        }
    }
    // A leading digit or symbol makes a name that reads like a system message
    // in chat, so require it to start with a letter.
    const char first = name[0];
    if (!((first >= 'a' && first <= 'z') || (first >= 'A' && first <= 'Z'))) {
        reasonOut = "Username must start with a letter.";
        return false;
    }
    return true;
}

bool validPassword(const std::string& password, std::string& reasonOut) {
    if (password.size() < kMinPassword) {
        reasonOut = "Password must be at least 6 characters.";
        return false;
    }
    // The upper bound is not a strength rule: bcrypt only considers the first
    // 72 bytes, and accepting megabytes of password is free work for an
    // attacker to hand us.
    if (password.size() > kMaxPassword) {
        reasonOut = "Password is too long.";
        return false;
    }
    return true;
}

std::string sanitizeChat(const std::string& text) {
    std::string out;
    out.reserve(std::min(text.size(), kMaxChatLength));
    for (const unsigned char c : text) {
        if (out.size() >= kMaxChatLength) break;
        // Newlines and control bytes would let a message forge extra lines or
        // corrupt the layout of whatever renders it.
        if (c < 0x20 || c == 0x7F) {
            if (c == '\t' || c == '\n') out += ' ';
            continue;
        }
        out += static_cast<char>(c);
    }
    // Trim, so a message of nothing but spaces is dropped rather than shown.
    const auto first = out.find_first_not_of(' ');
    if (first == std::string::npos) return {};
    const auto last = out.find_last_not_of(' ');
    return out.substr(first, last - first + 1);
}

std::string sanitizePlayerName(const std::string& name) {
    // Twenty characters is the browser build's cap (`playerName.slice(0, 20)`),
    // measured the same way it measures: in code units, not glyphs. A cut that
    // lands mid-sequence is walked back so the wire never carries broken UTF-8.
    constexpr std::size_t kMaxPlayerName = 20;
    std::string out;
    out.reserve(std::min(name.size(), kMaxPlayerName));
    for (const unsigned char c : name) {
        if (out.size() >= kMaxPlayerName) break;
        if (c < 0x20 || c == 0x7F) continue;
        out += static_cast<char>(c);
    }
    // A cut mid-sequence would put broken UTF-8 on the wire: walk back to the
    // start of the last character and drop it whole if it did not fit.
    std::size_t at = out.size();
    while (at > 0 && (static_cast<unsigned char>(out[at - 1]) & 0xC0) == 0x80) --at;
    if (at > 0) {
        const auto lead = static_cast<unsigned char>(out[at - 1]);
        const std::size_t need = lead < 0x80 ? 1 : lead < 0xE0 ? 2 : lead < 0xF0 ? 3 : 4;
        if (at - 1 + need != out.size()) out.resize(at - 1);
    }

    const auto first = out.find_first_not_of(' ');
    if (first == std::string::npos) return "Unnamed";
    const auto last = out.find_last_not_of(' ');
    return out.substr(first, last - first + 1);
}

} // namespace flr
