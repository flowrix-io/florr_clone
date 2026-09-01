#pragma once
// Per-connection state: the handshake, authentication, and the link between a
// socket, an account, and a player entity.
//
// A connection is deliberately NOT a player. It exists from the moment a
// socket opens; it acquires an account at login and a body at join, and it can
// drop the body (back to the title screen) without losing the account. Keeping
// those three lifetimes separate is what makes "leave to menu" and "reconnect"
// ordinary operations rather than special cases.

#include <cstdint>
#include <string>

#include "shared/core/entity.h"
#include "shared/net/protocol.h"

namespace flr {

enum class SessionStage : std::uint8_t {
    /// Connected, but has not sent a compatible Hello yet. Nothing else is
    /// accepted in this state, so an incompatible or hostile client cannot
    /// reach any game logic.
    Greeting = 0,
    /// Protocol accepted; may register, log in, or resume a session.
    Anonymous,
    /// Logged in, sitting on the title screen.
    Authenticated,
    /// Has a body in the world.
    Playing,
    /// Marked for disconnect; drained and dropped at the end of the tick.
    Closing,
};

struct Session {
    net::ConnectionId connection = 0;
    SessionStage stage = SessionStage::Greeting;

    std::string userId;
    std::string username;
    std::string token;
    bool admin = false;

    /// The player's body, while Playing.
    Entity entity = NULL_ENTITY;

    /// The biome this connection asked to start in, from JoinGame. Empty means
    /// the beginner ground. Kept on the session rather than passed down so a
    /// respawn lands where the player chose, not back at the default.
    std::string spawnBiome;

    /// The flower's name, typed on the title screen and sent with JoinGame.
    /// Separate from `username`: the account is who you are, this is what the
    /// nameplate says, and one player may use several. Empty means "Unnamed".
    std::string displayName;

    /// Input sequence already applied. Inputs at or below this are replays and
    /// are dropped, so a duplicated packet cannot move the player twice.
    std::uint32_t lastInputSequence = 0;

    /// Whether this body's death has already been announced. A player's corpse
    /// KEEPS its Dead tag so the client goes on being sent a dead flower, so
    /// the reaper sees it again every tick and needs to know it is done with
    /// it. Cleared when a new body is spawned.
    bool deathReported = false;

    // -- abuse limits ------------------------------------------------------
    //
    // A client controls how often it sends; the server controls how often it
    // will listen. Every counter here is refilled on a timer rather than reset
    // per tick, so a burst is absorbed but a sustained flood is not.

    double loginAttemptsAllowed = 5;
    double chatAllowance = 4;
    double inputAllowance = 60;
    double lastRefillMillis = 0;

    /// Snapshot of what this connection knows, owned by the replicator.
    std::uint32_t viewGeneration = 0;

    double connectedAtMillis = 0;
    double lastHeardMillis = 0;

    bool authenticated() const {
        return stage == SessionStage::Authenticated || stage == SessionStage::Playing;
    }
    bool playing() const { return stage == SessionStage::Playing && entity != NULL_ENTITY; }
};

/// Refills the per-session allowances. Called once per tick for every session.
void refillAllowances(Session& session, double nowMillis);

/// Takes one unit from `allowance` if available. Returns false when the client
/// has exceeded its budget, in which case the caller drops the message.
bool spend(double& allowance, double cost = 1.0);

/// Username rules, enforced at registration. Deliberately conservative: names
/// are rendered in chat and on nameplates, so control characters, homoglyph
/// padding and unbounded length are all rejected rather than sanitised later.
bool validUsername(const std::string& name, std::string& reasonOut);
bool validPassword(const std::string& password, std::string& reasonOut);

/// Strips control characters and clamps a typed flower name to the browser
/// build's twenty characters. An empty or all-blank name becomes "Unnamed",
/// because a nameplate has to say something.
std::string sanitizePlayerName(const std::string& name);

/// Strips control characters and clamps length for anything a player typed
/// that another player will see.
std::string sanitizeChat(const std::string& text);

} // namespace flr
