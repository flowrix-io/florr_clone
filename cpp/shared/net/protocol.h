#pragma once
// The client/server wire protocol.
//
// Framing:   every message is [u32 byteLength][u8 type][payload], little-endian.
// Direction: ClientMessage ids and ServerMessage ids are separate spaces.
//
// There are no type tags inside a payload -- both sides read the fields a
// message declares, in order. Compatibility is therefore established once, at
// connect time: the client sends kProtocolVersion together with a hash of the
// content it was built against, and a server that disagrees says so plainly
// instead of letting the two sides misread each other's bytes for a session.

#include <cstdint>

#include "shared/net/bytebuffer.h"

namespace flr::net {

/// Identifies one connected client for the lifetime of its socket.
using ConnectionId = std::uint32_t;

/// Bumped whenever any message layout in this file changes.
inline constexpr std::uint16_t kProtocolVersion = 1;

/// Frames larger than this are refused before allocation, so a bad length
/// prefix costs a dropped connection rather than a 4GB allocation.
inline constexpr std::uint32_t kMaxFrameBytes = 1u << 20;   // 1 MiB

/// Simulation rate. Fixed, because the physics integrates a constant step:
/// input, movement and cooldowns are all expressed per tick.
inline constexpr int kTicksPerSecond = 25;
inline constexpr double kTickSeconds = 1.0 / kTicksPerSecond;
inline constexpr double kTickMillis = 1000.0 / kTicksPerSecond;

/// How often each client is sent a snapshot. Equal to the tick rate today;
/// kept separate so it can be halved for distant or idle clients without the
/// simulation noticing.
inline constexpr int kSnapshotsPerSecond = kTicksPerSecond;

// ---------------------------------------------------------------------------
// Message ids
// ---------------------------------------------------------------------------

enum class ClientMessage : std::uint8_t {
    Hello = 1,          ///< u16 protocolVersion, u32 contentHash
    Register,           ///< str username, str password
    Login,              ///< str username, str password
    ResumeSession,      ///< str token
    Logout,             ///< (empty)
    JoinGame,           ///< u16 viewportWidth, u16 viewportHeight
    LeaveGame,          ///< (empty) -- back to the title screen, keeps the session
    Input,              ///< see InputFrame
    SetLoadout,         ///< u8 slot, u16 itemType, u8 rarity  (0xFFFF = clear)
    SwapLoadout,        ///< u8 slotA, u8 slotB
    Craft,              ///< u16 itemType, u8 rarity, u8 count
    Chat,               ///< str text
    Respawn,            ///< (empty)
    Ping,               ///< u64 clientTimeMillis
};

enum class ServerMessage : std::uint8_t {
    Welcome = 1,        ///< u16 protocolVersion, u8 accepted, str reason
    AuthResult,         ///< u8 status(AuthStatus), str token, str username, str reason
    Profile,            ///< full account state: xp, level, stars, inventory, loadout
    JoinAccepted,       ///< u32 selfNetId, f32 x, f32 y, u32 tick
    Snapshot,           ///< see below
    Chat,               ///< u8 channel, str author, str text
    Notice,             ///< u8 severity, str text
    Died,               ///< str killerName, u32 xpLost, u32 survivedTicks
    CraftResult,        ///< u8 success, u16 itemType, u8 rarity, str reason
    Leaderboard,        ///< u8 count, { str name, u32 score }*
    Pong,               ///< u64 clientTimeMillis, u64 serverTimeMillis
    Kick,               ///< str reason
};

enum class AuthStatus : std::uint8_t {
    Ok = 0,
    BadCredentials,
    UsernameTaken,
    UsernameInvalid,
    PasswordInvalid,
    SessionExpired,
    AlreadyOnline,
    RateLimited,
    ServerError,
};

enum class ChatChannel : std::uint8_t { Global = 0, System = 1, Squad = 2 };
enum class NoticeSeverity : std::uint8_t { Info = 0, Good = 1, Warning = 2, Bad = 3 };

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

enum InputFlags : std::uint8_t {
    InputAttack  = 1 << 0,
    InputDefend  = 1 << 1,
};

/// One tick of intent from a client.
///
/// `sequence` is echoed back in the next snapshot as `lastInputSequence`,
/// which is what lets the client discard the predicted inputs the server has
/// already applied and replay only the rest.
struct InputFrame {
    std::uint32_t sequence = 0;
    double moveAngle = 0;      ///< radians; meaningless when moveStrength is 0
    double moveStrength = 0;   ///< 0..1, so an analogue stick can walk
    double aimAngle = 0;       ///< radians, where the petals point
    std::uint8_t flags = 0;

    void write(ByteWriter& w) const {
        w.u32(sequence);
        w.angle(moveAngle);
        w.unitByte(moveStrength);
        w.angle(aimAngle);
        w.u8(flags);
    }

    static InputFrame read(ByteReader& r) {
        InputFrame f;
        f.sequence = r.u32();
        f.moveAngle = r.angle();
        f.moveStrength = r.unitByte();
        f.aimAngle = r.angle();
        f.flags = r.u8();
        return f;
    }

    bool attacking() const { return (flags & InputAttack) != 0; }
    bool defending() const { return (flags & InputDefend) != 0; }
};

// ---------------------------------------------------------------------------
// Snapshots
// ---------------------------------------------------------------------------

/// What a networked entity is, which decides how the client draws it.
enum class EntityKind : std::uint8_t {
    Player = 0,
    Mob,
    Petal,
    Projectile,
    Drop,        ///< a dropped petal waiting to be picked up
    Effect,      ///< a ground effect: poison cloud, web, lightning scar
};

/// Immutable per-entity facts, sent once when an entity first enters view.
enum SpawnFlags : std::uint8_t {
    SpawnHasName    = 1 << 0,   ///< a player name follows
    SpawnIsSelf     = 1 << 1,   ///< this is the viewer's own body
    SpawnIsPet      = 1 << 2,   ///< a summoned ally, drawn with an owner tint
};

/// Which mutable fields a snapshot carries for one entity this tick.
///
/// The mask exists because most entities change one or two of these per tick:
/// a drifting mob moves, a full-health petal does not, and a corpse changes
/// nothing at all. Sending the mask costs a byte and saves the rest.
enum UpdateFields : std::uint8_t {
    FieldPosition = 1 << 0,   ///< f32 x, f32 y
    FieldAngle    = 1 << 1,   ///< u16 quantised
    FieldHealth   = 1 << 2,   ///< u16 fraction of max
    FieldState    = 1 << 3,   ///< u8 EntityState bits
    FieldSize     = 1 << 4,   ///< f32 radius; changes only on level-up or growth
};

/// Transient visual state, refreshed whenever FieldState is set.
enum EntityState : std::uint8_t {
    StateHurt      = 1 << 0,   ///< took damage recently; draw the white flash
    StatePoisoned  = 1 << 1,
    StateSlowed    = 1 << 2,
    StateInvulnerable = 1 << 3,
    StateDefending = 1 << 4,   ///< petals pulled in
    StateAttacking = 1 << 5,   ///< petals pushed out
    StateDead      = 1 << 6,   ///< playing its death animation
};

/// One-off things that happened this tick, for effects the client can play
/// without the server streaming per-frame animation state.
enum class EventKind : std::uint8_t {
    Damage = 0,     ///< u32 netId, u16 amount, u8 crit -- floating number
    Heal,           ///< u32 netId, u16 amount
    PetalBroke,     ///< u32 ownerNetId, u8 slot
    Killed,         ///< u32 netId  -- pop/particles at its last position
    PickedUp,       ///< u32 dropNetId, u32 byNetId -- fly-to-player animation
    LevelUp,        ///< u32 netId, u16 newLevel
    Explosion,      ///< f32 x, f32 y, f32 radius, u8 colorIndex
};

// ---------------------------------------------------------------------------
// Content hash
// ---------------------------------------------------------------------------

/// FNV-1a over the config files both sides load.
///
/// Mob and petal stats are read from JSON at startup by BOTH the server and
/// the client (the client needs names, colours and artwork). If the two read
/// different files, every stat the client shows is quietly wrong. Hashing the
/// bytes at load and comparing them in the handshake turns that into an
/// explicit "your content is out of date" at connect time.
inline std::uint32_t contentHash(const std::string& text, std::uint32_t seed = 2166136261u) {
    std::uint32_t h = seed;
    for (const unsigned char c : text) {
        h ^= c;
        h *= 16777619u;
    }
    return h;
}

} // namespace flr::net
