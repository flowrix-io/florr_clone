#include "server/session.h"

#include <algorithm>

namespace flix {

namespace {

/// Allowance refill rates, per second.
constexpr double kLoginRefillPerSecond = 0.2;    // one attempt every 5s
constexpr double kChatRefillPerSecond = 0.5;     // one message every 2s
/// Inputs refill at the tick rate, which is the rate the client sends them at
/// (one per simulation tick, client/app_game.cpp). This was set when the tick
/// was 25 Hz, so it used to have room above it; at 30 Hz the only slack left
/// is the bucket's depth below.
constexpr double kInputRefillPerSecond = 30.0;
/// Commands refill four times faster than chat, off a deeper bucket.
///
/// The chat budget exists to stop one player flooding EVERYONE ELSE, and a
/// command floods nobody -- its output goes back to the sender alone. Held to
/// the chat rate, the admin console was unusable: four commands and then one
/// every two seconds, with `/help` and `/guild-info` each spending one. It is
/// still bounded, because some commands are expensive to serve.
constexpr double kCommandRefillPerSecond = 2.0;

constexpr double kMaxLoginAttempts = 5;
constexpr double kMaxChatAllowance = 4;
constexpr double kMaxCommandAllowance = 12;
constexpr double kMaxInputAllowance = 60;

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
    session.commandAllowance = std::min(
        kMaxCommandAllowance, session.commandAllowance + elapsed * kCommandRefillPerSecond);
}

bool spend(double& allowance, double cost) {
    if (allowance < cost) return false;
    allowance -= cost;
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

} // namespace flix
