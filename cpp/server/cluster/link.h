#pragma once
// What the gateway and the servers of a sharded game say to each other.
//
// One connection per server, dialled by the server, carrying the account rows
// lent to it and what the gateway has to answer for its players. Never the
// players' own traffic: a client is connected to the server its flower is on
// (ServerMessage::Redirect), and that server sends it its frames itself. What
// a client asks of the gateway -- a purchase, a guild, global chat -- is put
// on the link as a request (FromClient), behind the rows it may be about, and
// the gateway's answer comes back to be delivered (Deliver). It being ONE
// ordered stream is what that rests on: the gateway holds the record before
// it reads a request about it. What a player was shown and the gateway has not
// yet taken is in the server's lease journal (cluster/lease_journal.h).
// cpp/docs/ARCHITECTURE.md, "Sharding".
//
// The same framing and byte order as the client protocol, in a namespace of
// its own: neither end of this ever talks to a client with it. It is always a
// WebSocket, at /link (net::ws::kLinkPath), on the game's own port, the one
// players dial: the path is how the port tells a server from a client, in
// either build (net::Dialer::serverLink).

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
inline constexpr std::uint32_t kLinkVersion = 5;

/// A frame between servers carries a whole guild table or a whole account.
inline constexpr std::uint32_t kLinkMaxFrame = 64u << 20;
/// A link holding more than this is a server that has stopped reading.
inline constexpr std::size_t kLinkMaxPending = 256u << 20;
/// A link silent this long is taken for dead by either end. Generous: a server
/// building a whole map, or a gateway saving its database on a slow disk, goes
/// quiet for seconds.
inline constexpr double kLinkSilenceMillis = 15000.0;
inline constexpr double kLinkHeartbeatMillis = 1000.0;
/// How long a redirected client has to turn up where it was sent before its
/// session is given up on.
inline constexpr double kAttachPatienceMillis = 15000.0;
/// What a server keeps for a client on its way to it, before it gives up.
inline constexpr std::size_t kMaxTransitBytes = 8u << 20;

/// How many servers a game can have, and how the wire ids are shared out: the
/// top six bits of a net id are the server's slot, and slot 0 is nobody's.
inline constexpr int kMaxServers = 63;
inline constexpr std::uint32_t netIdBase(int slot) { return static_cast<std::uint32_t>(slot) << 26; }

enum class ToGateway : std::uint8_t {
    Hello = 1,       ///< Greeting -- in the clear, as Challenge and Proof are
    Proof,           ///< str proof. Everything after it, both ways, is sealed
    ClientFrame,     ///< u32 client, bytes -- for a client whose socket is not at this
                     ///< server's port (a squad here, an admin command run here):
                     ///< the gateway delivers it wherever the client is
    ClientClose,     ///< u32 client -- its socket at this server's port closed
    Rows,            ///< u64 seq, u16 n, { str user, u32 lease, u32 patchAck, blob row }*
    Table,           ///< str key, blob json
    LeaseReturned,   ///< u64 seq, u32 client, str user, u32 lease, u32 patchAck, blob row,
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
    FromClient,      ///< u32 client, u8 atMarket, bytes -- what a client at this
                     ///< server's port asked that is the gateway's to answer, behind
                     ///< everything it asked before; `atMarket` as FenceAck's
    Attached,        ///< u32 client -- a redirected client has arrived at this port
    CopyAck,         ///< u64 seq -- that much of the database copy is on disk here
    Recovered,       ///< u64 seq, u16 n, { str user, blob base, blob row }* -- rows
                     ///< from the lease journal that the gateway never took
    SquadNote,       ///< u32 client, u8 message, u8 first byte -- a SquadUpdate or
                     ///< SquadInviteReceived sent straight to a client here, which
                     ///< says where its squad is, which is where its squad
                     ///< commands have to go
};

enum class ToServer : std::uint8_t {
    Challenge = 1,   ///< str nonce, str proof
    Refused,         ///< str reason
    Ready,           ///< to a probe: the key is right and a server may join
    Welcome,         ///< u8 slot, i64 mazeDay, u64 taken, str host, u16 port --
                     ///< `taken` the last lease journal entry of this server's
                     ///< that the gateway has; host:port where clients sign in
                     ///< (an empty host: the one the server dials)
    Client,          ///< u32 client, ClientInfo -- opens it, or restates it
    ClientGone,      ///< u32 client
    ClientFrame,     ///< u32 client, bytes -- a frame of that client's for this server
                     ///< to carry out
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
    Deliver,         ///< u32 client, bytes -- the gateway's word to a client at this port
    Expect,          ///< u32 client, str ticket -- that client is being sent here
    Handled,         ///< u32 client -- the gateway has carried out the request of its
                     ///< that this server was holding the client's next ones behind
    RowsTaken,       ///< u64 seq -- the gateway's journal has this server's rows up to it
    CopyBegin,       ///< the whole database follows
    CopyRows,        ///< u64 seq, u16 n, { u8 table, str key, u8 exists, blob text }*
    CopyComplete,    ///< u64 seq -- all of it has been sent
    Address,         ///< str host, u16 port -- where clients that come through the
                     ///< proxy sign in, as Welcome's, since an admin set it
                     ///< (`/admin shards domain gateway`)
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
    /// Where clients that come through the game's proxy (Cloudflare) reach
    /// this server: its own hostname there (--public-host), or empty for none.
    /// A port of 0 is whichever the client reached the gateway on (443, behind
    /// Cloudflare). A domain an admin gives it on the gateway (`/admin shards
    /// domain`) wins: a server knows its address, not its name.
    std::string publicHost;
    std::uint16_t publicPort = 0;
    /// The port it takes clients on itself. Only a client that dialled the
    /// gateway straight, not through a proxy, is ever sent to it.
    std::uint16_t port = 0;

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

/// Who carries out a client's frame while its flower is on a simulation server.
enum class Where : std::uint8_t {
    Here,    ///< the gateway
    There,   ///< the server the flower is on
    Fenced,  ///< the gateway, once the server has carried out everything before it
};
Where whereHandled(net::ClientMessage id);
/// What a server sends the gateway and then holds the client's next frames
/// behind until it is told the request was carried out (ToServer::Handled):
/// the requests that spend, whose answer the next frame may need.
bool awaitsGateway(net::ClientMessage id);

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
        bool boss = false;           ///< an eternal or an apex is standing
    };
    std::vector<RealmLoad> realms;
    struct BossClock {
        std::string biome;
        double eternalLeft = 0;
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
