// Scheduled restarts, with their warnings in chat, and the self-update that
// schedules one once a new build is installed.

#include "server/game_server.h"

#include <algorithm>
#include <array>
#include <cmath>
#include <cstdio>

#include "server/auto_update.h"

namespace flix {

namespace {

/// How long before a restart each warning goes out, longest first. The
/// reference's RESTART_WARNINGS_MS.
constexpr std::array<double, 4> kRestartWarnings = {600000.0, 300000.0, 60000.0, 10000.0};

/// "daily" is the only reason with a friendlier name than itself.
std::string restartReasonText(const std::string& reason) {
    return reason == "daily" ? "daily maintenance" : reason;
}

/// The reference prefixes both of these with U+26A0. It is dropped here for
/// the same reason /guild-info's bullet was: there is one font in this build
/// and it cannot draw that glyph, so the sign would arrive as a hole in the
/// sentence. The words are the reference's, unchanged.
std::string restartWarning(double millis, const std::string& reason) {
    if (millis >= 60000.0) {
        const long minutes = std::lround(millis / 60000.0);
        return "<span style=\"color:#ffb74d;\">Server will restart in " +
               std::to_string(minutes) + (minutes == 1 ? " minute (" : " minutes (") +
               restartReasonText(reason) + ").</span>";
    }
    const long seconds = std::lround(millis / 1000.0);
    return "<span style=\"color:#ff6b6b;\">Server restarting in " + std::to_string(seconds) +
           (seconds == 1 ? " second!</span>" : " seconds!</span>");
}

} // namespace

bool GameServer::scheduleRestart(double delayMillis, const std::string& reason) {
    // A restart that has already announced itself and closed the door is not
    // one anybody can reschedule.
    if (restart_.firing) return false;
    if (delayMillis < 0) delayMillis = 0;

    restart_.pending = true;
    restart_.atMillis = clockMillis_ + delayMillis;
    restart_.reason = reason;
    // Warnings longer than the delay itself are skipped outright rather than
    // fired late: "restarting in 10 minutes" said one second before the exit
    // is worse than saying nothing.
    restart_.warningsSaid = 0;
    while (restart_.warningsSaid < kRestartWarnings.size() &&
           kRestartWarnings[restart_.warningsSaid] >= delayMillis) {
        ++restart_.warningsSaid;
    }
    return true;
}

bool GameServer::cancelScheduledRestart() {
    if (restart_.firing || !restart_.pending) return false;
    restart_ = ScheduledRestart{};
    return true;
}

bool GameServer::scheduledRestartInfo(double& remainingMillis, std::string& reason) const {
    if (!restart_.pending && !restart_.firing) return false;
    remainingMillis = std::max(0.0, restart_.atMillis - clockMillis_);
    reason = restart_.reason;
    return true;
}

void GameServer::serviceScheduledRestart(double nowMillis) {
    if (restart_.firing) {
        // The gap between the last word and the exit exists so the socket
        // writes actually leave: stopping in the same breath as the broadcast
        // drops the message that explains the disconnect.
        //
        // Non-zero, and set before the stop so whoever reads it after the loop
        // cannot see a half-finished answer: a supervisor that is told the
        // server exited cleanly leaves it down, and a restart nobody restarts
        // is just a shutdown with a countdown. See exitCode().
        if (nowMillis >= restart_.stopAtMillis) {
            exitCode_ = kRestartExit;
            stop();
        }
        return;
    }
    if (!restart_.pending) return;

    const double remaining = restart_.atMillis - nowMillis;
    while (restart_.warningsSaid < kRestartWarnings.size() &&
           remaining <= kRestartWarnings[restart_.warningsSaid]) {
        broadcastChat(net::ChatChannel::System, "System",
                      restartWarning(kRestartWarnings[restart_.warningsSaid], restart_.reason));
        ++restart_.warningsSaid;
    }
    if (remaining > 0) return;

    restart_.pending = false;
    restart_.firing = true;
    restart_.stopAtMillis = nowMillis + 1000.0;
    broadcastChat(net::ChatChannel::System, "System",
                  "<span style=\"color:#ff6b6b;\">Server restarting now (" +
                      restartReasonText(restart_.reason) +
                      "). Reconnecting shortly...</span>");
    std::printf("[restart] scheduled restart triggered (reason: %s)\n", restart_.reason.c_str());
}

void GameServer::serviceAutoUpdate() {
    net::Connection* requester =
        updateRequester_ != 0 ? listener_.find(updateRequester_) : nullptr;

    // Drained whether or not anybody is still listening: the lines are also
    // the JS side's console output, and leaving them queued would replay a
    // finished update's whole log at the next admin who asks for one.
    for (const std::string& line : autoupdate::drainLog()) {
        if (requester != nullptr) sendSystem(*requester, line);
    }

    switch (autoupdate::takeOutcome()) {
        case autoupdate::Outcome::Installed: {
            const bool scheduled = scheduleRestart(updateRestartDelayMillis_, "update");
            if (requester == nullptr) break;
            if (scheduled) {
                const long seconds = std::lround(updateRestartDelayMillis_ / 1000.0);
                sendSystem(*requester,
                           "[UPDATE] Done. Server restarts in " + std::to_string(seconds) +
                               "s to load the new build (\"restart cancel\" or \"update cancel\" "
                               "to abort the restart -- the new files stay installed either "
                               "way).");
            } else {
                sendSystem(*requester,
                           "[UPDATE] Done. A restart is already firing -- the new build loads "
                           "when the server comes back up.");
            }
            break;
        }
        case autoupdate::Outcome::Failed:
            // The JS side already said what went wrong, through the log above.
            break;
        case autoupdate::Outcome::None:
            break;
    }

    if (!autoupdate::inProgress()) updateRequester_ = 0;
}

} // namespace flix
