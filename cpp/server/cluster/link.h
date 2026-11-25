#pragma once
// What the gateway and the servers of a sharded game say to each other.
//
// One connection per server, dialled by the server, carrying everything: the
// frames of every client playing there, both ways, and the account rows those
// frames are about. It being ONE ordered stream is what the design rests on.
// A server puts the rows a tick changed on the link ahead of the frames that
// show the change, so by the time the gateway holds a byte a player will see,
// it already holds the record behind it -- and its own journal rule (nothing
// leaves before it is on disk) makes the pair durable without either side
// waiting for the other. cpp/docs/ARCHITECTURE.md, "Sharding".
//
// The same framing and byte order as the client protocol, in a namespace of
// its own: neither end of this ever talks to a client with it.

#include <cstdint>
#include <string>
#include <vector>

#include "shared/core/types.h"
#include "shared/game/realm.h"
#include "shared/net/bytebuffer.h"
#include "shared/net/protocol.h"

namespace flix::cluster {

/// Bump whenever anything below changes shape. Checked with the client
/// protocol's version and the content hash: a gateway takes no server built
/// from another tree.
inline constexpr std::uint32_t kLinkVersion = 2;

/// A frame between servers carries a whole guild table or a whole account.
inline constexpr std::uint32_t kLinkMaxFrame = 64u << 20;
/// A link holding more than this is a server that has stopped reading.
inline constexpr std::size_t kLinkMaxPending = 256u << 20;
/// A link silent this long is taken for dead by either end. Generous: a server
/// building a whole map, or a gateway saving its database on a slow disk, goes
/// quiet for seconds.
inline constexpr double kLinkSilenceMillis = 15000.0;
inline constexpr double kLinkHeartbeatMillis = 1000.0;

/// How many servers a game can have, and how the wire ids are shared out: the
/// top six bits of a net id are the server's slot, and slot 0 is nobody's.
inline constexpr int kMaxServers = 63;
inline constexpr std::uint32_t netIdBase(int slot) { return static_cast<std::uint32_t>(slot) << 26; }

enum class ToGateway : std::uint8_t {
    Hello = 1,       ///< Greeting -- in the clear, as Challenge and Proof are
    Proof,           ///< str proof. Everything after it, both ways, is sealed
    ClientFrame,     ///< u32 client, bytes
    ClientClose,     ///< u32 client
    Rows,            ///< u16 n, { str user, u32 lease, u32 patchAck, blob row }*
    Table,           ///< str key, blob json
    LeaseReturned,   ///< u32 client, str user, u32 lease, u32 patchAck, blob row,
                     ///< u32 profileRevision, f64 oracleWait, f64 traderWait, u8 onward,
                     ///< FlowerState -- when onward, for the gateway to find a server
    ClientState,     ///< u32 client, ClientState
    FenceAck,        ///< u32 client, u32 fence, u8 atMarket
    Released,        ///< str biome, blob drops
    Stats,           ///< ServerStats
    Chat,            ///< u8 channel, str author, str text, u32 speakerNetId
    Announce,        ///< str here, str elsewhere, u16 n, { u32 client }*
    Notification,    ///< str type, str message
    TitanForged,     ///< str user, str username, u16 petal
    TitanHolder,     ///< u32 client, u16 petal
    CreditKill,      ///< str user, str mob, u8 rarity, f64 stars
    TempAdminEnded,  ///< u32 client
    SquadMoved,      ///< u32 client, SquadState -- the squad left with that client
    Heartbeat,
    EdgeOpen,        ///< u32 edge, str address -- a client dialled this server's own port
    EdgeFrame,       ///< u32 edge, bytes
    EdgeClosed,      ///< u32 edge
    CopyAck,         ///< u64 seq -- that much of the database copy is on disk here
};

enum class ToServer : std::uint8_t {
    Challenge = 1,   ///< str nonce, str proof
    Refused,         ///< str reason
    Ready,           ///< to a probe: the key is right and a server may join
    Welcome,         ///< u8 slot, i64 mazeDay
    Client,          ///< u32 client, ClientInfo -- opens it, or restates it
    ClientGone,      ///< u32 client
    ClientFrame,     ///< u32 client, bytes
    Grant,           ///< u32 client, u32 lease, blob row, u32 profileRevision,
                     ///< f64 oracleWait, f64 traderWait, FlowerState
    RowPatch,        ///< str user, u32 lease, u32 seq, blob difference
    Fence,           ///< u32 client, u32 fence
    Account,         ///< blob json
    Table,           ///< str key, blob json
    Host,            ///< str biome, u8 n, { u8 realm }*, blob drops
    Release,         ///< str biome
    Reachable,       ///< kMaxRealms bytes: the realms some server simulates
    BotRaid,
    SquadLeaving,    ///< u32 client, str biome -- about to appear there
    Squad,           ///< SquadState
    Heartbeat,
    Restart,         ///< stop, handing everything back, and exit to be started again
    Update,          ///< f64 delay -- install the latest build, if it is this server's own to install
    Leave,           ///< be a server of one again, as it was before it was linked
    EdgeFrame,       ///< u32 edge, bytes
    EdgeClose,       ///< u32 edge
    CopyBegin,       ///< the whole database follows
    CopyRows,        ///< u64 seq, u16 n, { u8 table, str key, u8 exists, blob text }*
    CopyComplete,    ///< u64 seq -- all of it has been sent
};

/// The first thing a server says. In the clear, and believed only once the
/// key has been proven; nothing in it is worth having without the key.
struct Greeting {
    std::uint32_t linkVersion = 0;
    std::uint16_t protocol = 0;
    std::uint32_t contentHash = 0;
    std::string name;
    /// Made up once per server and kept: what tells the same server back on a
    /// new link from another one that was given its name.
    std::string id;
    std::string nonce;
    /// Only asking whether it could join: `/admin cluster connect` finds out
    /// before this server gives up the game it is running.
    bool probe = false;
    /// Wants the database copied to it.
    bool copy = false;
    /// The gateway's own simulation, in the gateway's own process.
    bool local = false;

    void write(ByteWriter& w) const;
    static Greeting read(ByteReader& r);
    /// Why a server of this build cannot take that one, or empty.
    std::string refusal() const;
    /// The whole greeting in one value, which both proofs and the link's keys
    /// are made over: nothing in it can be altered on the way.
    std::string digest() const;
};

/// Everything a server needs to know of a client it was not the one to sign in.
struct ClientInfo {
    std::string userId;
    std::string username;
    std::string address;
    std::string displayName;
    std::string spawnChoice;
    bool admin = false;
    std::int32_t adminTier = 0;
    /// A temporary grant's tier, or kNotAnAdmin.
    std::int32_t grantTier = 0;
    std::string grantedBy;
    /// The biome of the body this client has on ANOTHER server, if any.
    std::string elsewhere;

    void write(ByteWriter& w) const;
    static ClientInfo read(ByteReader& r);
};

/// How one equipped slot stood, so a ring crosses with the flower.
struct RingSlot {
    std::uint16_t petal = 0xFFFF;
    std::uint8_t rarity = 0;
    bool broken = false;
    double reloadLeft = 0;
    double health = 1;
    std::vector<float> grainsLeft;
};

/// A flower on its way to a server.
struct FlowerState {
    enum class How : std::uint8_t {
        Join = 0,   ///< from the title screen: answered with JoinAccepted
        Fresh,      ///< a respawn, or a server lost under a living flower
        Walk,       ///< through a pad, carrying what it was
    };
    How how = How::Join;
    Realm realm = Realm::Overworld;
    Vec2 position;
    std::string displayName;
    std::string spawnChoice;
    bool prestige = false;
    std::int32_t trialFloor = 0;
    double viewWidth = 0;
    double viewHeight = 0;

    // The way back out of a hosted game or a rift.
    bool arenaAdmitted = false;
    bool arenaReturn = false;
    Realm arenaReturnRealm = Realm::Overworld;
    Vec2 arenaReturnPosition;
    std::string arenaReturnChoice;

    // Walk only.
    bool dead = false;
    double angle = 0;
    double health = 1;       ///< fraction
    double shield = 0;
    double mana = 0;
    double invulnerableLeft = 0;
    bool god = false;
    bool phase = false;
    double splitLeft = 0;
    std::uint32_t inputSequence = 0;
    std::vector<RingSlot> ring;

    void write(ByteWriter& w) const;
    static FlowerState read(ByteReader& r);
};

/// What the gateway's own handlers have to know about a body elsewhere.
struct ClientState {
    bool playing = false;
    bool dead = false;
    bool split = false;
    bool arena = false;
    bool eventKit = false;
    bool controlled = false;
    Realm realm = Realm::Overworld;
    std::uint32_t netId = 0;
    std::int32_t level = 0;
    double oracleWait = 0;
    double traderWait = 0;

    void write(ByteWriter& w) const;
    static ClientState read(ByteReader& r);
};

struct SquadState {
    std::string id;
    bool isPublic = false;
    net::ConnectionId leader = 0;
    std::vector<net::ConnectionId> members;

    void write(ByteWriter& w) const;
    static SquadState read(ByteReader& r);
};

struct ServerStats {
    double tickMillis = 0;
    struct RealmLoad {
        Realm realm = Realm::Overworld;
        std::uint16_t humans = 0;
        std::uint16_t flowers = 0;   ///< bots included
        std::uint32_t mobs = 0;
        bool boss = false;           ///< a unique or an apex is standing
    };
    std::vector<RealmLoad> realms;
    struct BossClock {
        std::string biome;
        double uniqueLeft = 0;
        double apexLeft = 0;
    };
    std::vector<BossClock> clocks;

    void write(ByteWriter& w) const;
    static ServerStats read(ByteReader& r);
};

/// The answer to a challenge: proof of holding the shared secret without the
/// secret ever crossing the link. `who` keeps one side's proof from being
/// played back as the other's.
std::string linkProof(const std::string& secret, const char* who, const std::string& nonce,
                      const std::string& otherNonce);

/// What the two ends of one link seal their frames with: ChaCha20-Poly1305
/// under two keys, one per direction, made from the shared secret and both
/// ends' nonces, so no two links share one. The frame counter is the nonce --
/// the stream is ordered, so a frame dropped, repeated or moved does not open.
///
/// The accounts cross this link whole, password hashes with them, and two
/// servers joined by an admin command are as often as not on two rented
/// machines with the internet between.
class LinkCipher {
public:
    void start(const std::string& secret, const std::string& serverNonce,
               const std::string& gatewayNonce, bool gateway);
    bool started() const { return started_; }
    ByteWriter seal(const ByteWriter& message);
    /// The frame's content, or false for one the other end did not seal.
    bool open(const std::byte* data, std::size_t size, std::vector<std::byte>& out);

private:
    bool started_ = false;
    std::uint8_t sendKey_[32] = {};
    std::uint8_t receiveKey_[32] = {};
    std::uint64_t sent_ = 0;
    std::uint64_t received_ = 0;
};

/// The shortest key a link may be made with. A stranger who dials in is shown
/// an HMAC under it and may guess at leisure: `/admin cluster key new` makes
/// one nobody guesses.
inline constexpr std::size_t kMinLinkKey = 16;

} // namespace flix::cluster
