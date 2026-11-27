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
#include <deque>
#include <map>
#include <memory>
#include <string>
#include <vector>

#include "server/admin_tiers.h"
#include "server/cluster/link.h"
#include "server/db.h"
#include "shared/core/entity.h"
#include "shared/game/realm.h"
#include "shared/net/protocol.h"

namespace flix {

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
};

struct Session {
    net::ConnectionId connection = 0;
    SessionStage stage = SessionStage::Greeting;
    /// When the socket opened, on monotonicMillis(). A session still in
    /// Greeting kGreetingMillis after it is closed (GameServer::reapUngreeted):
    /// the client sends its Hello the moment it connects.
    double connectedAtMillis = 0;
    /// Where the connection really comes from, worked out once when it opened:
    /// the TCP peer, or the address a trusted proxy in front of the server
    /// named (clientAddress, server/account_limits.h). What every abuse limit
    /// is keyed on.
    std::string clientAddress;

    std::string userId;
    std::string username;
    std::string token;
    /// The account's admin flag, less a ban (Account::adminActive), copied at
    /// sign-in and moved by ban_admin / unban_admin while signed in.
    bool admin = false;
    /// The account's admin tier, copied with `admin` and read only while it is
    /// set. A temporary grant's tier is on the grant (GameServer::adminTier).
    int adminTier = kTopAdminTier;
    /// The session whose flower this one is steering through the admin
    /// dashboard's control, or 0. A CONNECTION and not a body: control follows
    /// the target's ACTIVE half (see `entity`), which a splitter swaps under
    /// it and a respawn replaces, so whatever is steered is looked up as
    /// sessionFor(controlling)->entity at the moment it is needed. See
    /// GameServer::beginControl for everything that starts and ends it.
    net::ConnectionId controlling = 0;
    /// The back-reference: the session steering THIS one's flower, or 0. What
    /// lets handleInput drop this player's own input without searching the
    /// session table on every packet, and what lets this side end the control
    /// when its flower goes away.
    net::ConnectionId controlledBy = 0;
    /// The account (userId) that typed the database editor's key on this
    /// connection, or empty. The editor answers only while this is the account
    /// signed in, so signing in as someone else on the same socket does not
    /// inherit the unlock. See server/admin_db_key.h.
    std::string adminDbUnlockedFor;

    /// The player's body, while Playing.
    ///
    /// While a splitter has this connection split in two, this is the ACTIVE
    /// half -- the one the client steers, the one its camera sits on and the
    /// one its snapshot stream is built around. The other half is `splitOther`
    /// and is parked exactly where it was left. Everything that means "act on
    /// my flower" reads this and therefore follows the switch for free; the
    /// few rules that mean "any body this person owns" walk both (see
    /// GameServer::bodiesOf).
    Entity entity = NULL_ENTITY;

    /// The splitter's other body, or NULL_ENTITY when this connection is not
    /// split.
    ///
    /// Two bodies, one account: the inventory, the loadout and the talent tree
    /// live on the RECORD here rather than on the body, so the halves cannot
    /// drift into the duplication the browser build's per-body loadout clone
    /// produced. What is genuinely per-body -- position, health, the ring --
    /// is exactly what a second body is for.
    Entity splitOther = NULL_ENTITY;

    // -- the mob damage board (GameServer::sendMobDamageBoard) ----------------
    /// The boss-tier mobs this player has damaged and is still following: the
    /// board shows the nearest of them. Dropped when the mob is gone or two
    /// minutes after the player's last hit on it.
    struct BoardTrack {
        Entity mob = NULL_ENTITY;
        /// This player's damage on the mob the last time the board looked: a
        /// rise means they are still hitting it.
        double own = 0;
        double lastHitMillis = 0;
    };
    std::vector<BoardTrack> boardTracks;
    /// Rate limit: the board is rebuilt and resent no more than every 250 ms.
    double boardNextSendMillis = 0;
    /// A board is on the client's screen and needs clearing when it ends.
    bool boardShown = false;
    /// The client's Show Mob Damage Board setting (net::SetMobDamageBoard).
    bool boardWanted = true;
    /// Whether the board also covers Super mobs (the client's Super setting).
    bool boardSuper = true;
    /// The attack/defend bits the half of a split flower that is NOT being
    /// steered holds: what this player's flower does with no button held,
    /// from the InputInvertAttack / InputInvertDefend bits of their last input
    /// frame. Zero for a player without either setting, which is a parked
    /// half with its petals at rest.
    std::uint8_t parkedInputFlags = 0;

    /// The last body taken out of the world, and the account it was playing
    /// for, until spawnPlayer makes the next one.
    ///
    /// Mob damage ledgers name a flower by body (Bounty::handOver), and the
    /// client's way back from the death card is LeaveGame, then JoinGame from
    /// the title screen: seconds with no body at all, between a corpse that is
    /// destroyed and a flower that does not exist yet. This is what still
    /// names the person in between -- the next body inherits its rows, and a
    /// boss that falls in the gap is credited to them (creditedSession) rather
    /// than to nobody. The account rides along so a socket that signed into
    /// another one meanwhile never hands it someone else's damage.
    Entity lastBody = NULL_ENTITY;
    std::string lastBodyUserId;

    /// The earliest the splitter may cut this flower in two again.
    ///
    /// Zero -- the ordinary case -- means "the moment it is equipped", which is
    /// the whole point of the petal: wearing it splits you, with nothing to
    /// wait for. This is armed only when a half is LOST, so the spare is not
    /// replaced on the tick after something killed it.
    ///
    /// Deliberately not the slot's own `reloadReadyAtMillis`. Every slot
    /// serves a full reload the moment its contents change, login included
    /// (PetalSystem::reconcileSlots), so reading that would make equipping a
    /// splitter mean "split in ten seconds" -- which is the reload the petal is
    /// explicitly not supposed to charge for being worn.
    double splitReadyAtMillis = 0;

    /// When this session's next TitanHolder query will be answered, on the
    /// server's tick clock. See kTitanHolderQueryMillis.
    double nextTitanQueryMillis = 0;

    /// The revision of the last Profile or ProfileDelta sent on this
    /// connection, 0 before the first, and when its next ProfileCheck is worth
    /// folding the bag for, on the server's tick clock. See
    /// GameServer::handleProfileCheck.
    std::uint32_t profileRevision = 0;
    double nextProfileCheckMillis = 0;
    /// What kills and pickups changed since the last Profile or delta: the
    /// bag's (petal, rarity) groups and the ledger's (mob, rarity) cells, each
    /// listed once. GameServer::sendDueProfiles sends them with the next
    /// snapshot, as a ProfileDelta.
    struct ProfileCell {
        std::uint16_t index = 0;
        Rarity rarity = Rarity::Common;
        bool operator==(const ProfileCell& o) const { return index == o.index && rarity == o.rarity; }
    };
    std::vector<ProfileCell> stacksDue;
    std::vector<ProfileCell> killsDue;
    /// Whether anything is owed: a delta has nothing to say but its header
    /// when a kill earned no ledger cell this client is shown.
    bool profileDue = false;

    /// What this connection's client was last told, so GameServer::sendProfile
    /// can send what changed since instead of the whole account. The bag and
    /// the ledger as sorted (petal or mob, rarity) cells -- the bag's in walk
    /// order within a cell, the ledger's one per cell, the count the client
    /// keeps -- and each small section as the bytes it was written as. Not
    /// `known` until a whole Profile has gone on this connection.
    struct ProfileShadow {
        struct Cell {
            std::uint32_t key = 0;   ///< index << 8 | rarity
            std::uint32_t count = 0;
        };
        bool known = false;
        std::vector<Cell> stacks;
        std::vector<Cell> kills;
        std::vector<std::byte> identity, bar, skills, presets;
    };
    ProfileShadow profileShadow;

    /// The spawn point this connection asked to start at, from JoinGame.
    ///
    /// One of WorldMaps::spawnChoices()' ids -- a player spawn rectangle on
    /// some map -- or "pvp"/"maze" for the two realms that have no map file.
    /// Empty means the overworld's default. Kept on the session rather than
    /// passed down so a respawn lands where the player chose, not back at the
    /// default.
    std::string spawnChoice;

    /// Non-zero while the body was started from the Trial Grounds floor picker.
    int trialFloor = 0;
    /// The private generated realm reserved for this Trial Grounds run.
    Realm trialRealm = Realm::Overworld;

    /// Whether that door's PRESTIGE twin was asked for and granted
    /// (shared/game/prestige.h). Kept beside spawnChoice so a respawn goes
    /// back to the prestige biome; never set for the arena or the maze, which
    /// have no twin.
    bool prestige = false;

    /// The coordinate space the body is in while Playing (realm.h). Overworld
    /// between bodies, so a title-screen session reads as ordinary ground.
    Realm realm = Realm::Overworld;

    /// The arena run's account, while there is one.
    ///
    /// A flower in the PVP ring plays on a scratch copy of its account: a fixed
    /// starter ring, an empty inventory, no talents, and whatever it loots in
    /// there. Every handler that reads "the player's inventory or loadout"
    /// reads this instead while it is set (GameServer::liveRecord), which is
    /// how the real record is never touched by a run -- the reference's
    /// regularInventory/regularLoadout stash, turned inside out. A quarter of
    /// the run's loot reaches the real account when the run ends
    /// (src/server/playerManager.ts:99-158). Null outside the ring.
    std::unique_ptr<PlayerRecord> arena;
    std::uint32_t adminToolsRevision = 0;
    bool marketAccess = false; // Granted near Mr. Bee; revoked on leave/respawn.
    std::unique_ptr<PlayerRecord> eventKit; // Never persisted or refunded.
    // Temporarily hidden by event rules, restored when those rules permit it.
    std::unique_ptr<PlayerRecord> eventRestricted;

    /// The flower's name, typed on the title screen and sent with JoinGame.
    /// Separate from `username`: the account is who you are, this is what the
    /// nameplate says, and one player may use several. Empty means "Unnamed".
    std::string displayName;

    /// Input sequence already applied. Inputs at or below this are replays and
    /// are dropped, so a duplicated packet cannot move the player twice.
    std::uint32_t lastInputSequence = 0;
    Entity cursorDragged = NULL_ENTITY;
    Entity cursorBody = NULL_ENTITY;
    Realm cursorRealm = Realm::Overworld;
    std::uint8_t cursorButtons = 0;
    bool adminArenaAdmitted = false;
    bool adminArenaHasReturn = false;
    Realm adminArenaReturnRealm = Realm::Overworld;
    Vec2 adminArenaReturnPosition;
    std::string adminArenaReturnChoice;
    /// Where this flower stepped into the rift, for /admin stop_waves to put
    /// it back. A flower that leaves by the Exit button goes to the title
    /// screen instead, as any other flower does.
    bool wavesHasReturn = false;
    Realm wavesReturnRealm = Realm::Overworld;
    Vec2 wavesReturnPosition;
    /// When this flower began standing on the rift; 0 when it is not.
    double riftChargeSinceMillis = 0;
    /// What a dead flower's camera is following in the waves, and when it last
    /// lost something to follow (flooooio player_dead_camera.go).
    Entity waveSpectating = NULL_ENTITY;
    double waveSpectateSinceMillis = 0;
    bool adminKillHeld = false;
    bool adminTeleportHeld = false;
    Entity adminKillBody = NULL_ENTITY;
    Realm adminKillRealm = Realm::Overworld;
    double adminKillReadyAtMillis = 0;

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
    double nextChatMillis = 0; // Shared by every player-chat channel and announcements.
    /// Slash commands, budgeted separately from chat. A command's output goes
    /// back to its sender, so the flood the chat budget is guarding against is
    /// not the one a command can cause -- see session.cpp.
    double commandAllowance = 12;
    double inputAllowance = net::kInputsPerSecond * 2.0;
    /// Inventory, loadout and talent mutations share a budget: alternating
    /// opcodes must not bypass the limit or spend the movement budget.
    double inventoryAllowance = 20;
    /// Everything else a player asks for by clicking: joining, leaving and
    /// respawning, skins, guild actions, the leaderboard and the feed. Each
    /// answers with a Profile, a map grid, a broadcast or a walk of a whole
    /// table, and none is something a person does many times a second.
    double requestAllowance = 10;
    double lastRefillMillis = 0;

    /// The lines this connection said to other players lately, oldest
    /// first, for the repeat check (GameServer::screenChatLine): where each
    /// went and what it drew, folded (chatRepeatKey), and when.
    struct SaidLine {
        std::string key;
        double atMillis = 0;
    };
    std::deque<SaidLine> recentLines;

    /// The guildmate wire ids last sent to this client (GuildMapUpdate),
    /// sorted, so an unchanged set is not sent again.
    std::vector<std::uint32_t> guildMapIds;

    // -- sharding (cpp/docs/ARCHITECTURE.md, "Sharding") ---------------------

    /// On the gateway: where this client's flower is, when it has one. The
    /// gateway simulates nothing, so its own `entity` is always null and its
    /// `stage` never Playing; whoever is in the world is in it over there.
    struct Elsewhere {
        /// The server its body is on, or 0.
        int slot = 0;
        std::uint32_t lease = 0;
        /// What that server last said of the body.
        cluster::ClientState state;
        /// A flower on its way to a server that cannot take it yet.
        std::unique_ptr<cluster::FlowerState> entering;
        double enteringSinceMillis = 0;
        /// Messages that came while an earlier one was still being carried
        /// out, in order: behind a fence, a leave, or an arrival.
        std::deque<std::vector<std::byte>> held;
        std::uint32_t fenceSeq = 0;
        bool fenced = false;
        bool leaving = false;
        /// The held message now being run is the fenced one.
        bool pastFence = false;
        /// The last fence found the body standing at Mr. Bee.
        bool atMarket = false;
        /// The server whose squads this client is in, or was last invited by.
        int squadSlot = 0;
        bool inSquad = false;
        /// Every server that knows this client, and the ClientInfo it has.
        std::map<int, std::vector<std::byte>> told;

        /// Where the client's socket is: 0 for the gateway's own port, or the
        /// slot of the server whose port it was sent to. Never relayed:
        /// whatever the gateway says to it goes there.
        int carrier = 0;
        /// The server it was at before, whose port may still hand on what it
        /// sent there before it was told to go.
        int lastCarrier = 0;
        /// Sent on again before it got home: where to, once it has (the
        /// redirect there is the last thing in `outbox`).
        int pendingCarrier = 0;
        /// Its socket at the gateway's port, or 0.
        net::ConnectionId door = 0;
        /// Sent to `carrier` and not there yet: since when, or 0.
        double transitSinceMillis = 0;
        /// What a client on its way back to the gateway shows to be let in.
        std::string ticket;
        /// What was said to it on its way back, kept until it arrives.
        std::deque<std::vector<std::byte>> outbox;
        std::size_t outboxBytes = 0;
        /// The frame being carried out came from the server the client is at,
        /// which had carried out everything sent before it (FromClient): a
        /// fence is already behind it, and this is what it found.
        bool viaCarrier = false;
        bool carrierAtMarket = false;
        /// Its socket here came through a proxy (Cloudflare): it is only ever
        /// sent to a server's proxied hostname, never to its own port.
        bool viaProxy = false;

        bool busy() const { return fenced || leaving || entering != nullptr; }
    };
    Elsewhere elsewhere;

    /// On a simulation server: the loan this client's row is here on, or 0
    /// for a client with no body here -- one that is in a squad here, or that
    /// was here earlier and whose boss damage still counts.
    std::uint32_t lease = 0;
    /// The last of the gateway's edits to that row taken.
    std::uint32_t patchAck = 0;
    /// The biome this client's body is in, when another server has it.
    std::string elsewhereBiome;
    /// The ClientState the gateway was last told.
    std::vector<std::byte> toldState;
    /// On a simulation server: the client's socket at this server's own port,
    /// or 0 for a client whose socket is elsewhere.
    net::ConnectionId door = 0;
    /// The gateway is sending the client here: what is said to it waits for it.
    bool expected = false;
    std::deque<std::vector<std::byte>> transit;
    std::size_t transitBytes = 0;
    /// Holding what it sends behind a request the gateway has not yet carried
    /// out (cluster::awaitsGateway), whose answer they may need.
    bool awaitingGateway = false;
    std::deque<std::vector<std::byte>> heldForGateway;

    bool authenticated() const {
        return stage == SessionStage::Authenticated || stage == SessionStage::Playing;
    }
    bool playing() const { return stage == SessionStage::Playing && entity != NULL_ENTITY; }
    /// What the flower's nameplate says: the name typed on the title screen,
    /// or the account's when none was.
    const std::string& nameplate() const { return displayName.empty() ? username : displayName; }
    /// Whether the session's body is in `r`.
    bool playingIn(Realm r) const { return playing() && realm == r; }
    /// The realm whose rules the account is on now: the body's, or the
    /// overworld's with no body. The maze shifts the ring and has a track of
    /// its own, so the Profile and the bar are read through this.
    Realm accountRealm() const { return playing() ? realm : Realm::Overworld; }
    /// Whether a splitter has given this connection a second body.
    bool split() const { return splitOther != NULL_ENTITY; }
    /// Whether `body` is one of this session's own -- either half.
    bool owns(Entity body) const {
        return body != NULL_ENTITY && (body == entity || body == splitOther);
    }
};

/// Refills the per-session allowances. Called once per tick for every session.
void refillAllowances(Session& session, double nowMillis);

/// Takes one unit from `allowance` if available. Returns false when the client
/// has exceeded its budget, in which case the caller drops the message.
bool spend(double& allowance, double cost = 1.0);

inline constexpr double kChatCooldownMillis = 500.0;
bool claimChatCooldown(Session&, double nowMillis);

/// Strips control characters and clamps a typed flower name to the browser
/// build's twenty characters. An empty or all-blank name becomes "Unnamed",
/// because a nameplate has to say something.
std::string sanitizePlayerName(const std::string& name);

/// Strips control characters and clamps length for anything a player typed
/// that another player will see.
std::string sanitizeChat(const std::string& text);

} // namespace flix
