#pragma once
// The authoritative game server: one world, one fixed-rate tick, N clients.
//
// Everything the simulation needs is owned here and passed down. Systems hold
// no global state and no references to each other -- they are given the world
// and whatever read-only services they need, and they communicate through
// components and the command buffer. That is what makes them testable in
// isolation and what keeps the tick order legible in one function.

#include <array>
#include <atomic>
#include <cstdint>
#include <deque>
#include <memory>
#include <optional>
#include <string>
#include <unordered_map>
#include <vector>

#include "server/account_limits.h"
#include "server/bot_ai.h"
#include "server/db.h"
#include "server/replication.h"
#include "server/session.h"
#include "server/squads.h"
#include "shared/core/world.h"
#include "shared/game/components.h"
#include "shared/game/map_elements.h"
#include "shared/game/spatial.h"
#include "shared/game/terrain.h"
#include "shared/net/admin_db.h"
#include "shared/net/transport.h"

namespace flix {

class MovementSystem;
class MobAiSystem;
class PetalSystem;
class CombatSystem;
class SpawnSystem;
class ModeSpawner;
class LootSystem;
class NpcSystem;
class DungeonSystem;

namespace testsupport {
/// The test suite's friend of GameServer; tests/server_harness.h defines it
/// and says what it is for.
struct GameServerPeer;
} // namespace testsupport

/// One loadout slot as the body in a given realm wears it: the account's
/// petal, or the maze's shifted-and-benched version of it. See wornSlot().
struct WornSlot {
    std::uint16_t petalIndex = kNoPetal;
    Rarity rarity = Rarity::Common;
};

/// The dense petal index behind a key an account's bag files a stack under
/// ("petal_rose"), or kInvalidIndex for a key this build has no petal for.
/// Defined in game_server.cpp beside inventoryKey(), which is the one place
/// the two spellings meet; declared here for the other server files that read
/// a bag -- the dashboard's inventory view -- so they do not grow a second.
std::uint16_t petalIndexFromInventoryKey(const std::string& key);

/// The type tag a notification row carries, as the wire enum: the four the
/// browser build stored (super_craft, unique_craft, apex_craft, star_code) and
/// the titan forge's universal_craft. Anything else is Generic, which is also
/// what an older notification with no type reads as. The one list of tags
/// there is: the feed reads rows through it, and `/admin notification` refuses
/// a tag it answers Generic for. Defined in game_server.cpp.
net::NotificationKind notificationKind(const std::string& type);

/// Milliseconds since the first call, from a steady clock.
///
/// The simulation's clock: every `nowMillis` a system is handed comes from
/// here, so anything that has to place itself on the same timeline -- an
/// admin-spawned mob's lifetime, a cooldown -- must read it rather than a
/// clock of its own.
double monotonicMillis();

/// Hard ceiling on the bot population, whatever the target arithmetic or an
/// admin override says. Named here rather than in game_server.cpp because the
/// console quotes it back in `/admin set_bot_count`'s usage line.
///
/// Twice the browser build's MAX_BOT_COUNT, deliberately: a bot costs this
/// server about 0.02ms of tick, so a hundred of them is around two
/// milliseconds of a thirty-three millisecond budget, and the ceiling exists
/// to stop an operator asking for something absurd rather than to hold a line
/// the machine cannot cross. The DEFAULT population is untouched -- that is
/// kBotTargetTotalPlayers, and this only bounds what `set_bot_count` may ask
/// for.
inline constexpr int kMaxBots = 100;

struct ServerConfig {
    std::uint16_t port = 3000;
    std::string dataDir = "data";
    std::string databasePath = "inventory.json";
    std::uint64_t worldSeed = 0x5EED10;
    /// TLS material, used only by the emscripten build. With it the listener
    /// serves https and offers WebTransport alongside WebSocket; without it,
    /// plain http and WebSocket only -- WebTransport is secure-context only
    /// and cannot be offered at all. The native build speaks TCP and ignores
    /// both.
    std::string certPath;
    std::string keyPath;
    /// Directory the emscripten build serves the client from, over the same
    /// port the game itself uses. Empty means the build directory the server
    /// module was loaded from. Unused natively.
    std::string webRoot;
    /// How many bots to keep in the world, or -1 for the usual population
    /// (kBotTargetTotalPlayers minus the humans online). Zero is a world with
    /// no bots in it at all.
    ///
    /// Here for the tests. Bots are spread over every biome a player can join
    /// (botBiomes()), the overworld a test joins into among them, and each is
    /// born in the doors and beginner bands a joining player is put down in
    /// (pickBotSpawn) -- which is what a live server WANTS and what makes
    /// "these two flowers are the only ones in sight" or "this mob lived long
    /// enough to fire" impossible to state. `/admin set_bot_count` is the same
    /// knob at run time; this is the one a harness can set before the first
    /// tick.
    int botCount = -1;
    /// The `/admin db` key to use as is, instead of deriving one from the
    /// machine's address and the database's secret. Empty means derive. Only
    /// the offline page sets it: its server is a browser tab with no address
    /// to ask for and a fresh secret in every browser, so a derived key would
    /// differ per install -- and that machine is the player's own anyway.
    std::string fixedAdminDbKey;
};

class GameServer : public net::TransportHandler {
public:
    GameServer();
    ~GameServer() override;

    /// Loads content and the database, generates the world, and binds the
    /// port. Returns false with `errorOut` set on any failure -- a server that
    /// cannot load its accounts must not start and silently serve none.
    bool start(const ServerConfig& config, std::string& errorOut);

    /// Runs until stop() is called or a signal is caught.
    void run();

    /// One pass of that loop: service the network, and tick if a tick is due.
    /// Returns false once the server is finished. run() is a loop over this;
    /// the emscripten build cannot own the loop -- blocking the Node event
    /// loop is what would stop every WebSocket message from ever arriving --
    /// and drives this from a timer callback instead.
    bool step();

    /// Flushes every playing account and the database, then drops the
    /// listener. run() does this on the way out; the emscripten build calls it
    /// when step() first returns false.
    void shutdown();

    /// The flush without the stop: every playing account is written to the
    /// database and the database to disk, and the server carries on. What
    /// the periodic save does on its own timer, and what the `save` console
    /// command and the offline page's unload handler do on demand -- a tab
    /// that is closing has no shutdown() coming, only this. Returns how many
    /// accounts were written.
    std::size_t persistAll();

    /// Makes the account signed in with `sessionToken` a permanent admin, and
    /// tells its live session so. False when the token resolves to no account
    /// -- empty, unknown, expired or orphaned; granting one that already has
    /// the flag is a no-op that still reports true.
    ///
    /// Keyed on the token the client was ISSUED, never on a name: the account
    /// the grant lands on is the database's answer for a credential the server
    /// minted (Database::resolveSession), so no string a player chooses -- an
    /// account name, a nameplate -- can aim it. See CLAUDE.md, "Admin rights".
    ///
    /// Deliberately not reachable from a socket: no message carries it and no
    /// chat command calls it. The one caller is the single-file offline build,
    /// where the server runs inside the player's own page and the page's own
    /// client hands it its token -- there "give me the console" is a button on
    /// a world only they can reach, not an escalation. A network build links
    /// this and never calls it, which is what keeps `/admin grant_admin` the
    /// only way in from outside.
    bool grantAdmin(const std::string& sessionToken);

    /// Safe to call from a signal handler: it only stores to an atomic flag,
    /// and the shutdown work itself happens on the main thread.
    void stop() { running_.store(false); }

    /// What a process exiting on this server's own account should exit WITH,
    /// once run() (or the last step()) is done. 0 for an ordinary shutdown --
    /// a signal, a tab closing -- and kRestartExit when the server stopped in
    /// order to be started again.
    ///
    /// The distinction is not cosmetic: a restart has to come back under every
    /// supervisor this is run by, and only a non-zero code does that
    /// everywhere. pm2 with its default autorestart restarts on ANY exit, 0
    /// included -- unless the app lists 0 in stop_exit_codes -- but systemd's
    /// Restart=on-failure (and docker's on-failure policy) restarts only a
    /// non-zero one and reads exit 0 as "this process was meant to end". A
    /// restart that exited 0 would leave such a server down instead of
    /// restarting it -- exactly what `restart` and the last step of `update`
    /// must not do, since nothing else is coming to bring the server back. A
    /// clean shutdown exits 0 for the converse reason: wherever the supervisor
    /// honours it, 0 is the code that means "stay down".
    int exitCode() const { return exitCode_; }

    /// The code a restart exits with. Any non-zero value does the job; 1 is
    /// the one the browser build's memory restart already used.
    static constexpr int kRestartExit = 1;

    /// One fixed simulation step. Deliberately does NOT touch the network, so
    /// a test can drive the simulation deterministically without a clock.
    void tick(double nowMillis);

    /// Accepts connections and dispatches whatever has arrived, for up to
    /// `timeoutMillis`. run() interleaves this with tick(); a test drives the
    /// two itself.
    void serviceNetwork(int timeoutMillis);

    World& world() { return world_; }
    /// The account store, for reading. Tests assert against it and the console
    /// reports out of it; nothing outside this class writes to it.
    const Database& database() const { return database_; }
    /// The key `/admin db` asks for, derived at start() from the machine's
    /// private address and the database's secret (server/admin_db_key.h).
    const std::string& adminDbKey() const { return adminDbKey_; }
    const Terrain& terrain() const { return *terrain_; }
    /// Every staged map's annotation layer, and which realm each one is.
    const WorldMaps& worldMaps() const { return worldMaps_; }
    std::size_t playerCount() const;
    /// The biomes the bot population is spread over, by name, in the spawn
    /// picker's order. Public because the claim "evenly, and not into ground
    /// nothing lives on" is one the tests and tools/bot_probe check, and a
    /// checker that rebuilt the rule for itself would stop checking it the
    /// first time the rule changed.
    std::vector<std::string> botBiomeNames() const;

    // net::TransportHandler
    void onConnect(net::Connection& c) override;
    void onMessage(net::Connection& c, ByteReader& reader) override;
    void onDisconnect(net::Connection& c, const std::string& reason) override;

private:
    /// The test suite's one way past the interface above. A test otherwise
    /// reaches a server only through what is public -- its socket, its world,
    /// the database it reads back -- and this is for the few that must put a
    /// session into a state no message leads to any more: a stage that stopped
    /// saying Playing while its body stood, which a repeated Hello used to
    /// leave. That state is what the second line of defence in onDisconnect,
    /// signOut, leaveWorld, spawnPlayer and endControl is for, and with every
    /// road to it closed, nothing else could tell that code from dead code.
    /// Defined only by the tests, so no shipping build uses it.
    friend struct testsupport::GameServerPeer;

    // -- message handling --------------------------------------------------
    /// The handshake, accepted once per socket: a second Hello closes the
    /// connection rather than resetting the stage under a body.
    void handleHello(Session&, net::Connection&, ByteReader&);
    void handleRegister(Session&, net::Connection&, ByteReader&);
    void handleLogin(Session&, net::Connection&, ByteReader&);
    void handleResume(Session&, net::Connection&, ByteReader&);
    void handleChangePassword(Session&, net::Connection&, ByteReader&);
    /// Logs the ACCOUNT out, not just this connection: every token it holds is
    /// revoked, and every other connection signed into it is signed out too.
    void handleLogout(Session&);
    /// Takes one connection back to Anonymous: its squad left, its body saved
    /// and removed, its temporary admin dropped, and nothing left that names
    /// the account. Touches no token -- revoking those is the caller's
    /// decision.
    void signOut(Session&);
    /// Called by a login, a registration and a resume once the credential has
    /// checked out, before `incomingUserId`'s state is installed on the socket.
    /// Signing in as ANOTHER account ends what belonged to the old one on this
    /// connection: a temporary admin grant -- lent to a person for one life,
    /// not to a socket -- any flower control, either end of it, and the squad
    /// with any squad invitation pending for it, which are keyed by the
    /// connection and would otherwise pass to the account signing in. Signing
    /// in as the same account again ends nothing here; a sign-in that arrived
    /// from inside the world has already left it by then (leaveWorld), which
    /// ends that life's grant and control with the body.
    void releaseOnAccountChange(Session&, const std::string& incomingUserId);
    /// One account, one live session: signs out and closes every OTHER
    /// connection already holding `userId`, telling each one why. Called by a
    /// login or a resume once the credential has checked out, and before the
    /// account is read back for the incoming connection.
    void replaceOtherSessions(const Session& incoming, const std::string& userId);
    void handleJoin(Session&, net::Connection&, ByteReader&);
    void handleLeave(Session&, net::Connection&);
    /// Takes the session's body out of the world the way LeaveGame does: its
    /// progress saved into the account it belongs to, the body and its kit
    /// removed -- any split and any flower control ending with it -- and a
    /// temporary admin grant, lent for one life, dropped. Nothing for a
    /// session with no body. Keyed on the body rather than on playing(), and
    /// saving only a Playing session's (spawnPlayer says why). handleLeave is
    /// this plus the profile that tells the client where it is now. A login,
    /// a registration or a resume that arrives on a socket still in the world
    /// calls it before the incoming account is installed: the stage drops
    /// back to signed-in there, and a body left standing would belong to no
    /// session's account, bank its pickups into whichever account the socket
    /// had switched to, and be orphaned for good by the next join.
    void leaveWorld(Session&);
    void handleInput(Session&, ByteReader&);
    void handleChat(Session&, net::Connection&, ByteReader&);
    void handleSetLoadout(Session&, ByteReader&);
    void handleSwapLoadout(Session&, ByteReader&);
    void handleSwapLoadoutRows(Session&, net::Connection&);
    void handleSaveLoadoutPreset(Session&, net::Connection&, ByteReader&);
    void handleLoadLoadoutPreset(Session&, net::Connection&, ByteReader&);
    /// True, with the player told why, when the session's body is in the maze,
    /// which locks the loadout for the run. Every loadout edit asks first.
    bool loadoutLockedInMaze(Session&);
    void handleCraft(Session&, net::Connection&, ByteReader&);
    /// A guaranteed craft at an oracle. Refused unless the session's body is
    /// alive and standing at one; see NpcSystem::findService.
    void handleOracleCraft(Session&, net::Connection&, ByteReader&);
    /// One petal for one coin of its tier at a trader. Refused unless the
    /// session's body is alive and standing at one, as the oracle's craft is.
    void handleTrade(Session&, net::Connection&, ByteReader&);
    /// kTitanForgeCost apex petals for one universal at a titan, standing at
    /// one as the oracle's craft is; then takeUniversals for everyone else,
    /// unless the forger is an admin (see tracksUniversals).
    void handleTitanForge(Session&, net::Connection&, ByteReader&);
    /// Who holds `petalIndex` at universal, for the titan to name.
    void handleTitanHolder(Session&, net::Connection&, ByteReader&);
    /// Whether the one-of-each rule sees this account's universals: every
    /// account but a database admin's. An admin's are neither named by the
    /// titan nor taken by another player's forge, and an admin's forge takes
    /// nobody's and is not announced.
    bool tracksUniversals(const std::string& userId) const;
    /// The username of a tracked account holding `petalIndex` at universal,
    /// or empty: the memo while it is fresh, else a sweep of every account.
    std::string universalHolderName(std::uint16_t petalIndex);
    /// Takes every universal `petalIndex` from every tracked account but
    /// `keeperId`, bag and loadout, refunding kTitanForgeRefund apex for each,
    /// and tells the live ones. Returns how many universals were taken.
    int takeUniversals(std::uint16_t petalIndex, const std::string& keeperId);
    void handleRespawn(Session&);
    void handlePing(net::Connection&, ByteReader&);
    void handleUpgradeSkill(Session&, net::Connection&, ByteReader&);
    void handleResetSkills(Session&, net::Connection&);
    void handleBuyPetal(Session&, net::Connection&, ByteReader&);
    void handleRedeemCode(Session&, net::Connection&, ByteReader&);
    void handleSetSkin(Session&, net::Connection&, ByteReader&);
    void handlePublishSkin(Session&, net::Connection&, ByteReader&);
    void handleEquipSkin(Session&, net::Connection&, ByteReader&);
    void handleDeleteSkin(Session&, net::Connection&, ByteReader&);
    void handleLeaderboard(const Session&, net::Connection&, ByteReader&);
    void handleNotifications(net::Connection&, ByteReader&);
    void handleUsePetal(Session&, ByteReader&);

    // -- the admin database editor (server/admin_db.cpp) --------------------
    //
    // The panel `/admin db` opens. Every op is refused unless the DATABASE
    // flags the session's account as an admin: a temporary grant reaches the
    // console, not this, because the editor reaches further than the console
    // -- passwords, deletions, any record. The admin flag itself is the one
    // thing it never writes, for anyone (see admin_db.cpp).

    void handleAdminDb(Session&, net::Connection&, ByteReader&);
    /// Tells a client to open the editor, on `username` when one is named.
    void sendAdminDbOpen(net::Connection&, const std::string& username);
    void sendAdminDbResult(net::Connection&, bool ok, net::AdminDbScope, const std::string& key,
                           bool gone, const std::string& message);
    /// One node of an account's document or of a table, or false when the
    /// document or the path no longer exists.
    bool sendAdminDbAccount(net::Connection&, const std::string& username,
                            const net::AdminDbPath&);
    bool sendAdminDbTable(net::Connection&, const std::string& table, const net::AdminDbPath&);
    std::uint8_t adminDbAccountFlags(const Account&) const;
    void adminDbList(net::Connection&, const std::string& search, std::uint32_t offset);
    void adminDbEdit(Session&, net::Connection&, ByteReader&, bool remove);
    void adminDbAccountAction(Session&, net::Connection&, net::AdminDbOp, ByteReader&);
    /// Pushes an edited account onto its live sessions: the body's XP and
    /// level, everything applyAccountToSession copies, and a fresh profile.
    /// See admin_db.cpp for why the body has to be written.
    void adminDbRefreshLive(const std::string& userId);
    /// Signs out every live connection on `userId`, telling each why. Returns
    /// how many there were.
    int adminDbSignOutConnections(const std::string& userId, const std::string& reason);

    // -- the admin dashboard (server/admin_dashboard.cpp) --------------------
    //
    // The panel `/admin gui` and the strip's admin button open: the flowers in
    // the world, one player's bag, flower control, and the console's spawn,
    // give and announce -- which it sends AS console commands, so their answers
    // land in chat where the console's always do. Anyone the console answers
    // may use it (effectiveAdmin), and every request is checked again here:
    // nothing is trusted from the panel being open.
    //
    // Control arrives by two roads, as the guild's operations do: the panel's
    // binary request, and `/admin control` / `/admin release`. Both reach
    // controlFlower and releaseFlower, so the two cannot disagree about who may
    // steer whom.

    void handleAdminDashboard(Session&, net::Connection&, ByteReader&);
    /// One page of the flowers in the world whose account name or nameplate
    /// holds `search`, case-insensitively, in account-name order.
    void sendDashboardPlayers(net::Connection&, const std::string& search, std::uint32_t offset);
    /// One page of `target`'s bag, read from the account's own progress record
    /// -- what `give` writes -- and never from an arena run's scratch kit.
    /// Answered as gone unless `target` still holds `username`, the account
    /// the panel picked it as.
    void sendDashboardInventory(net::Connection&, net::ConnectionId target,
                                const std::string& username, std::uint32_t offset);
    /// How a Control or Release request went, for the panel's status line.
    void sendDashboardResult(net::Connection&, bool ok, const std::string& message);
    /// Tells `controller`'s client whose flower it is steering now, if anybody's.
    void sendControlState(const Session& controller);

    /// Takes `target`'s flower for `admin`, or refuses. Either way `answer` is
    /// the one sentence both roads show; true means control has begun.
    bool controlFlower(Session& admin, Session& target, std::string& answer);
    /// Gives the steered flower back. False, with nothing changed and `answer`
    /// saying so, when there was nothing to release.
    bool releaseFlower(Session& admin, std::string& answer);
    /// Why `admin` may not take `target`'s flower now, or empty when it may.
    std::string controlRefusal(const Session& admin, const Session& target) const;
    /// Why a control already running cannot go on, or empty while it holds.
    std::string controlLapse(const Session& controller) const;
    /// Wires the two sessions together and moves the admin's view onto the
    /// target's flower. Only ever called once controlRefusal has said yes.
    void beginControl(Session& admin, Session& target);
    /// Ends `controller`'s control, both back-references and both bodies: the
    /// one that stops being steered is parked rather than left walking its
    /// last heading. `why`, when not empty, is told to the admin as a System
    /// line. `restate` moves the admin's view back onto their own flower, which
    /// a controller on their way out of the world has no use for.
    void endControl(Session& controller, const std::string& why, bool restate);
    /// Ends whatever control `session` is part of, from either end, through
    /// the back-references -- what every way out of the world calls, and an
    /// account changing on the socket. `leaving` is that the session's own
    /// body is about to go, so its view is not restated onto it.
    void endControlOf(Session&, const std::string& why, bool leaving);
    /// Ends every control that lapsed this tick: either side stopped playing
    /// or died, the two are in different realms, or the controller lost the
    /// standing it took the flower with. Once a tick, next to the splitter
    /// service and before the reaper, so a death ends control before the
    /// corpse is announced.
    void serviceControl();
    /// The body `session`'s snapshot stream is built around: the steered
    /// flower's active half while it controls one, else its own. Reads only.
    Entity viewpointOf(const Session&) const;
    /// Restates a client's whole view around viewpointOf(): the RealmChange
    /// that clears what it holds and snaps its camera, with the server-side
    /// view reset in the same breath. See switchSplitHalf for why a moved
    /// self flag needs both halves of that.
    void restateView(Session&);
    /// The steered flower's active half just changed under its controller --
    /// a splitter switch, or the steered half dying with the other still up.
    /// Control follows the active half, so the admin's view is restated onto
    /// it exactly as the target's own client's is.
    void followControlledHalf(Session& target);

    // -- the splitter ------------------------------------------------------
    //
    // One connection, two flowers. The petal is not used from a chord the way
    // the browser build used it (U + the slot number): it is CLICKED on the
    // loadout bar, and it does two different things depending on the state of
    // the slot. Equipping it splits the flower at once, for nothing; clicking
    // the loaded petal afterwards hands control to the other half and spends
    // the slot, so a switch costs a reload.
    //
    // The bookkeeping lives on the Session (`entity` is the active half,
    // `splitOther` the parked one) rather than in a table keyed by entity,
    // because every "act on my flower" path already reads session.entity and
    // therefore follows a switch without knowing one happened.

    /// Splits, merges, switches on a death, and keeps the parked half parked.
    /// Called once a tick, between the systems and the reaper: a half that
    /// died this tick has to stop being part of the session BEFORE the reaper
    /// meets it, or its owner is sent a death card for a body they are not
    /// steering.
    void serviceSplitters(double nowMillis);
    /// Cuts `session`'s flower in two. False when it could not be done at all
    /// -- no body, no world to build a second one in, or a PVP run, whose
    /// score and bag are settled through the session and could not survive a
    /// half dying under it.
    bool splitSession(Session&);
    /// Ends the split, destroying the parked half. `armReload` puts the
    /// splitter slot on its cooldown, which is what stops a half that just
    /// died from being replaced on the very next tick.
    void endSplit(Session&, double nowMillis, bool armReload);
    /// Hands control to the parked half and spends the splitter slot on both.
    void switchSplitHalf(Session&, double nowMillis);
    /// Stops a body where it stands: no input, no velocity, no knockback.
    /// Only the ACTIVE half is written by handleInput, so without this the
    /// parked one replays the last heading it was given and walks away.
    void parkBody(Entity);
    /// Which active slot holds a splitter, or -1. Reloading or not: a slot
    /// serving its cooldown is still equipped, and the split outlives it.
    int splitterSlotOf(Entity body) const;
    /// Puts the splitter slot on its reload on BOTH halves, so the bar reads
    /// the same whichever body is being steered.
    void armSplitterReload(const Session&, double nowMillis);
    /// Copies the account-scoped progress the halves must agree about -- XP,
    /// level, stars -- from whichever body has the most onto the other.
    /// Whichever half a kill was credited to, the account keeps it.
    void syncSplitProgress(const Session&);
    /// Both bodies this session owns, active half first; the second is
    /// NULL_ENTITY unless it is split.
    std::array<Entity, 2> bodiesOf(const Session&) const;
    /// The line refusing a squad door to a split flower, or empty. `whoLabel`
    /// is how it names them ("You are", "bob is"), exactly as the biome
    /// refusal beside it does.
    std::string splitSquadRefusal(SquadMemberId, const std::string& whoLabel) const;

    /// Appends one row to the global notification feed.
    ///
    /// The three things that write to it -- a rare craft (a titan's forge
    /// included), a redeemed star code and the admin `notification` command --
    /// are the three the browser build had, and they all come through here so
    /// that the row shape, the id format and the history cap cannot drift apart
    /// between them.
    void addNotification(const std::string& type, const std::string& message);
    /// The global line and the feed row a super/unique/apex craft produces,
    /// and a universal forged at a titan. Silent for every tier below, which
    /// is where the reference draws the line too -- an ultra is crafted often
    /// enough to be noise.
    void announceRareCraft(const Session&, std::uint16_t petalIndex, Rarity made);
    /// How long `userId` has left to wait for the oracle, 0 when it may craft.
    /// A lapsed wait is forgotten on the way.
    double oracleWaitMillis(const std::string& userId);
    /// The same for the trader: 0 when `userId` may trade.
    double traderWaitMillis(const std::string& userId);
    /// Distinguishes two notifications written in the same millisecond. The id
    /// is only ever compared -- a client keys its read marks on it -- so a
    /// counter does the reference's nine random characters' whole job.
    std::uint64_t notificationSequence_ = 0;

    // -- guilds ------------------------------------------------------------
    //
    // Storage is the database's own `guilds` table, in the browser build's
    // shape: an object keyed by the upper-cased five-character name, each
    // value carrying {name, leaderUsername, memberUsernames, createdAt}, plus
    // the optional displayName and description server/guilds.h describes. Held
    // as JSON in the shape existing database files carry, rather than mirrored
    // into a typed cache: a second copy is a second thing to keep true.
    void handleGuildCreate(Session&, net::Connection&, ByteReader&);
    void handleGuildEdit(Session&, net::Connection&, ByteReader&);
    void handleGuildInvite(Session&, net::Connection&, ByteReader&);
    void handleGuildAccept(Session&, net::Connection&);
    void handleGuildDecline(Session&, net::Connection&);
    void handleGuildKick(Session&, net::Connection&, ByteReader&);
    void handleGuildLeave(Session&, net::Connection&);
    void handleGuildSquadAll(Session&, net::Connection&);
    void handleGuildInviteToSquad(Session&, net::Connection&, ByteReader&);

    // The argument-taking cores behind the four guild messages that carry one.
    //
    // Split out because the same operations arrive by two roads: the guild
    // panel's binary messages, and the `/guild-create`-style chat commands the
    // reference also accepts. A second implementation of "may this player
    // invite?" would be a second answer to it.
    void guildCreate(Session&, net::Connection&, const std::string& tag,
                     const std::string& displayName);
    /// Replaces whichever of the two is given. Leader only. `/guild-rename`
    /// and `/guild-description` each pass one; the panel's GuildEdit both.
    void guildEdit(Session&, net::Connection&, const std::optional<std::string>& displayName,
                   const std::optional<std::string>& description);
    void guildInvite(Session&, net::Connection&, const std::string& target);
    void guildKick(Session&, net::Connection&, const std::string& target);
    void guildInviteToSquad(Session&, net::Connection&, const std::string& target);

    // -- squads ------------------------------------------------------------
    //
    // The roster itself is server/squads.h; what lives here is everything that
    // needs the world or a socket -- naming a member, telling one, and keeping
    // the loot ranking's table of who fights together up to date.

    /// How this session is named inside a squad. A connection, not an entity:
    /// a body is destroyed and rebuilt on every death, and a party that lost
    /// its members each time somebody died would not be a party.
    static SquadMemberId squadIdOf(const Session& session) {
        return SquadMemberId::ofSession(session.connection);
    }
    /// The account name a member answers to. A bot has no account, so it
    /// answers to its nameplate -- which is what `/squad-invite` matches on.
    std::string squadAccountName(SquadMemberId);
    /// What this member's flower is labelled, which is what the squad's own
    /// announcements name it by.
    std::string squadDisplayName(SquadMemberId);
    /// The body a member owns right now -- a player's active half, a bot's
    /// one body -- or NULL_ENTITY for a member without one.
    Entity squadEntityOf(SquadMemberId) const;
    net::Connection* squadConnection(SquadMemberId);

    /// The roster as this client should see it. A null squad is the browser's
    /// `squadUpdate null` and carries nothing after its flag.
    void sendSquadUpdate(net::Connection&, const Squad*);
    /// Sends the roster to every human in it. Called after every membership,
    /// leadership or visibility change -- and after a member spawns or
    /// despawns, because the wire ids in it belong to bodies.
    void broadcastSquadUpdate(const Squad&);
    /// The squad's own notice, on its channel with no author, to every human
    /// member.
    void sendSquadSystem(const Squad&, const std::string& text);
    /// The same for a guild record: to every member signed in.
    void sendGuildSystem(const Json& guild, const std::string& text);
    /// Resolves an invite target: a signed-in player first, then a bot by
    /// nameplate, exactly as the reference resolves it.
    bool resolveSquadTarget(const std::string& name, SquadMemberId& out);
    /// Takes this session out of its squad and tells everyone concerned.
    void departSquad(Session&, net::Connection*, const std::string& leaverName);
    /// Drops a bot out of whatever squad it was in, on its way out of the
    /// world. A squad holding a destroyed body would rank a corpse for loot.
    void removeBotFromSquad(Entity body);
    /// Rebuilds the loot ranking's table of who fights together. Once a tick
    /// rather than on membership change: a member's BODY changes on every
    /// death, so a table cached against the roster goes stale without the
    /// roster ever moving.
    void rebuildSquadIndex();
    /// The caller's squad, creating a private one if they have none. Four
    /// copies of this create-then-announce dance lived across the reference's
    /// own squad commands.
    Squad* squadOrCreate(Session&, net::Connection&);
    /// Every squadmate's body, for the replicator: a squad member is streamed
    /// however far away they are, which is what makes the party HUD and the
    /// pink minimap dots work across the map.
    void collectSquadBodies(const Session&, std::vector<Entity>& out);

    /// The biome a member counts as being in.
    ///
    /// A squad may not span biomes, so every join has to be able to say where
    /// somebody IS -- including somebody who has no body just now. A member
    /// with one answers with its realm's biome; one sitting on the title
    /// screen or on a death card answers with the biome the door they PICKED
    /// is about to put them in, because that is where they will be standing
    /// by the time the squad matters. Empty when neither is known -- no body
    /// and no door of their own -- which is treated as "no objection" rather
    /// than as a biome of its own. The default door is not an answer: it is
    /// what the picker opens on, and reading it as one put every lobby in the
    /// garden.
    std::string squadMemberBiome(SquadMemberId) const;
    /// The biome a squad is in: its leader's, falling back to the first member
    /// that has one. Empty when nobody in it does.
    std::string squadBiome(const Squad&) const;
    /// Whether `who` may sit in `squad`: they are in its biome, or one of
    /// the two cannot be placed at all, which is no reason to refuse.
    bool squadAcceptsBiome(const Squad&, SquadMemberId who) const;
    /// The line refusing them, or empty when squadAcceptsBiome() says yes --
    /// `whoLabel` is how it names them ("You are", "bob is").
    std::string squadBiomeRefusal(const Squad&, SquadMemberId who,
                                  const std::string& whoLabel) const;
    /// Takes a member out of their squad when they have just arrived in a
    /// biome the rest of it is not in. Called from the two places a flower
    /// changes realm: a fresh body, and a pad.
    void enforceSquadBiome(SquadMemberId);

    // -- chat commands -----------------------------------------------------
    //
    // Implemented in server/chat_commands.cpp. A chat line beginning with '/'
    // never reaches the global channel: it is answered, refused, or reported
    // unknown, which is the difference between a command surface and a player
    // typing "/help" at everyone.

    /// True when `message` was a command -- handled, refused or unknown -- and
    /// must not be broadcast. False means an ordinary chat line.
    bool handleChatCommand(Session&, net::Connection&, const std::string& message);

    /// One `/squad ...` line, already split into its subcommand and first
    /// argument. Both spellings the reference accepts -- `/squad invite x` and
    /// `/squad-invite x` -- are rewritten into this one shape before they get
    /// here, so the two cannot drift apart.
    void runSquadCommand(Session&, net::Connection&, const std::string& sub,
                         const std::string& argument);

    /// One `/admin` (or `/cmd`) body, already stripped of its prefix. The
    /// caller has checked that this session may run it.
    void runAdminCommand(Session&, net::Connection&, const std::string& command);

    /// One System line to one connection. Console output is one line per
    /// message rather than one message with embedded newlines, where the
    /// browser build joined its lines with `<br/>`; the client parses that
    /// markup as well (client/ui/markup.cpp), so a reply may be either, and
    /// /help and /guild-info are one message joined with `<br/>`.
    void sendSystem(net::Connection&, const std::string& text);

    // -- scheduled restart -------------------------------------------------
    //
    // The console's `restart`, and the last step of `update`. A restart IS a
    // process exit: pm2, systemd or docker is what actually brings the server
    // back up. Players are warned on the way down, which is the whole reason
    // it is scheduled rather than immediate.

    struct ScheduledRestart {
        bool pending = false;
        /// Past the point of cancelling: the last word has been said and the
        /// process is on its way out.
        bool firing = false;
        double atMillis = 0;
        std::string reason;
        /// How many of the warning marks have already been announced. Starts
        /// past the ones a short delay skips entirely.
        std::size_t warningsSaid = 0;
        /// When the process actually stops, a second after the final notice,
        /// so it reaches the sockets before they close.
        double stopAtMillis = 0;
    };
    ScheduledRestart restart_;

    /// Schedules a restart in `delayMillis`, replacing any pending one.
    /// False when one is already firing, which cannot be called off.
    bool scheduleRestart(double delayMillis, const std::string& reason);
    bool cancelScheduledRestart();
    /// Remaining time and reason; false when nothing is scheduled.
    bool scheduledRestartInfo(double& remainingMillis, std::string& reason) const;
    /// Says the warnings that have come due and fires the restart at its
    /// moment. Called once a tick, ABOVE the idle gate: a server with nobody
    /// on it is exactly the one a restart is usually waiting for.
    void serviceScheduledRestart(double nowMillis);

    /// Forwards a running install's progress to whoever asked for it, and
    /// schedules the restart a finished one has earned. Called once a tick,
    /// beside the restart service and for the same reason.
    void serviceAutoUpdate();
    /// Who asked for the running install. A connection, not a session: the
    /// answer follows the socket, and a socket that has gone is simply not
    /// written to.
    net::ConnectionId updateRequester_ = 0;
    /// How long after a successful install its restart is scheduled for.
    double updateRestartDelayMillis_ = 60000;

    /// Rotates the maze the server is playing. Returns the line the console
    /// prints, which is the reference's own answer for each case.
    std::string adminChangeMaze(const std::string& argument);
    /// Tells one client, or every playing one, which maze the server is on.
    void sendMazeInfo(net::Connection&);
    void broadcastMazeInfo();
    /// How far the active maze has been pushed from the real UTC day by
    /// `change-maze`. Reported back so an operator can see they are off it.
    std::int64_t mazeDayOffset_ = 0;

    /// Whether this session may run admin commands: a database admin, or the
    /// holder of a temporary grant. `session.admin` alone is the database flag
    /// and deliberately does not move when a grant is made.
    bool effectiveAdmin(const Session&) const;

    /// What an admin command's `<player>` argument resolved to.
    ///
    /// Bots resolve as well as people -- teleporting them is half of what the
    /// command exists for -- so the session is optional and the entity is not.
    struct CommandTarget {
        Entity entity = NULL_ENTITY;
        Session* session = nullptr;   ///< null for a bot
        /// For output: the account name, or a bot's nameplate, since a bot
        /// owns no account. Never a person's nameplate, so a confirmation
        /// names who was actually acted on.
        std::string name;
    };
    /// Matches a playing person by ACCOUNT name, or a bot by its nameplate,
    /// case-insensitively. A person's nameplate never resolves: it is
    /// whatever their client typed on the title screen, unique to nobody, so
    /// a flower wearing an absent player's name would otherwise receive the
    /// grant, the give or the control meant for them. Accounts that are not
    /// playing do not resolve here; the commands that work offline (give,
    /// mute) fall back to the database by account name themselves.
    bool resolveCommandTarget(const std::string& identifier, CommandTarget& out);

    /// Moves a body within its realm, its velocity and knockback cleared so it
    /// does not arrive sliding. It sends nothing: the client cuts its
    /// interpolation by itself on any jump past kTeleportSnapDistance
    /// (client/interpolation.h, 600 units), which every teleport worth the
    /// name exceeds, and eases across a shorter one.
    void teleportEntity(Entity, Vec2);

    /// Drops a temporary admin grant, if this connection holds one. A grant is
    /// lent for one life, as the reference lends it, and to a person rather
    /// than a socket, so every way that life or that person ends calls this:
    /// a respawn (handleRespawn); leaving the world, to the title screen or by
    /// a re-auth from inside it (leaveWorld); the socket closing
    /// (onDisconnect); a sign-out of any kind -- Log Out, a session replaced by
    /// a newer sign-in, the database editor's sign-out (all signOut); a sign-in
    /// as another account on the same socket (releaseOnAccountChange); and
    /// `/admin revoke_admin`.
    void revokeTempAdmin(net::ConnectionId);

    void sendAuthResult(net::Connection&, net::AuthStatus, const std::string& token,
                        const std::string& username, const std::string& reason);
    /// The settings panel's change-password reply. `token` is the replacement
    /// session, empty on a refusal.
    void sendChangePasswordResult(net::Connection&, bool ok, const std::string& token,
                                  const std::string& reason);
    void sendProfile(Session&, net::Connection&);
    /// Claims today's daily-login reward and tells the client, so the title
    /// screen's streak card has something to count down. Called BEFORE
    /// sendProfile: the claim credits stars to the record, and a profile built
    /// first would arrive one day's reward short.
    void sendDailyStreak(Session&, net::Connection&);
    void sendNotice(net::Connection&, net::NoticeSeverity, const std::string& text);
    /// The shop's own reply channel. A refused purchase or code is a modal on
    /// the shop card in the reference, not a line in the chat, so it cannot
    /// travel as a Notice.
    void sendShopResult(net::Connection&, net::ShopResultKind, bool ok, double stars,
                        const std::string& message);
    /// `speakerNetId` is the flower that said it, which is what lets every
    /// client float the line over that body as well as printing it. Zero --
    /// the default -- is the server talking in its own voice, and draws no
    /// bubble over anybody.
    void broadcastChat(net::ChatChannel, const std::string& author, const std::string& text,
                       std::uint32_t speakerNetId = 0);
    /// One chat line to one connection, under a chosen author -- a channel's
    /// own notice, unsigned, or a line said to a group -- which a Notice,
    /// whose author is always System, cannot express.
    void sendChatTo(net::Connection&, net::ChatChannel, const std::string& author,
                    const std::string& text);
    /// A player's line said in public: to everyone on Global, or on Local to
    /// the players whose screens hold the speaker's flower. Billed to the chat
    /// allowance and barred by a mute, as anything said to another player is.
    void sayInPublic(Session&, net::Connection&, net::ChatChannel, const std::string& text);
    /// True, with the speaker told so, when the session's account is muted.
    /// Every road a line takes to another player asks this first -- Global and
    /// Local through sayInPublic, a guild or squad line, a whisper -- so the
    /// mute is one rule and its notice one sentence (server/chat_commands.cpp).
    bool speakerMuted(const Session&, net::Connection&);
    /// Cuts every picture not served by a listed image host out of a line a
    /// player is about to say to others, telling them what went and why.
    /// False when nothing is left worth sending.
    bool screenChatImages(net::Connection& speaker, std::string& text);
    /// A Local line, to every player in the speaker's realm whose viewport has
    /// the speaker's flower on it, the speaker included.
    void sendLocalChat(const Session& speaker, const std::string& text,
                       std::uint32_t speakerNetId);
    /// The backlog broadcastChat keeps, as one ChatHistory message. Sent once
    /// per authentication, which is the moment broadcastChat starts including
    /// this connection -- so the backlog and the live stream meet exactly.
    void sendChatHistory(net::Connection&);

    /// The guild `username` belongs to, or an empty string. Searched rather
    /// than indexed: membership lives on the guild, not on the account, and a
    /// derived index would be a second thing to keep true.
    std::string guildNameForUser(const std::string& username) const;
    Session* sessionForUser(const std::string& username);
    net::Connection* connectionForUser(const std::string& username);
    /// One roster message: the guild as it stands, each member flagged online
    /// and placed. Built once per broadcast and sent to every member, since
    /// what it says is the same for all of them.
    ByteWriter guildRosterMessage(const Json& guild);
    /// Where an online member is, for the roster's location column: the biome
    /// their body stands in, or empty when they have no body.
    std::string guildLocation(const Session&) const;
    /// Re-sends the roster of every guild whose members' presence changed since
    /// the last call: somebody connected, disconnected, or walked into another
    /// biome. Polled rather than hooked, because a body changes biome in a
    /// dozen places and a disconnect in several, and none of them should have
    /// to know a guild is watching.
    void serviceGuildPresence(double nowMillis);
    /// The biome boss clocks live in the database's `bossClocks` table as
    /// wall-clock ready times, so a restart neither resets a cooldown nor
    /// re-deals one. restoreBossClocks hands the spawner what the table holds,
    /// once, on the first tick (the first time this run's clock is known);
    /// persistBossClocks writes back whatever moved since it last looked --
    /// a scatter, an upgrade, a console spawn charging a clock.
    void restoreBossClocks(double nowMillis);
    void persistBossClocks();
    /// The no-guild answer, which is the browser's `guildUpdate null`.
    void sendNoGuild(net::Connection&);
    /// Sends `guild` to every one of its members who is connected.
    void broadcastGuildRoster(const Json& guild);
    /// Tells this connection about its own guild, or that it has none. Sent
    /// once per authentication, and after every change that could alter it.
    void sendGuildState(const Session&, net::Connection&);
    /// The whole published-skin catalog, this client's admin flag and the skin
    /// its account is wearing. Sent once per authentication, beside the
    /// profile: a client that has not seen a skin cannot draw whoever wears it.
    void sendSkinCatalog(Session&, net::Connection&);
    /// One prebuilt message to every logged-in connection. A published or
    /// deleted skin changes what EVERY screen must be able to draw, not just
    /// the author's.
    void broadcastToAuthenticated(const ByteWriter& message);
    /// Memory and tick-time for the client debug menu's graphs, once a second.
    /// Skipped entirely while nobody is logged in, exactly as the browser
    /// server's own interval is: an idle server should send nothing.
    void broadcastDebugStats();

    // -- lifecycle ---------------------------------------------------------
    Entity spawnPlayer(Session&);
    /// Assembles one player body in `realm` at `position` and writes the
    /// account onto it. Everything spawnPlayer does EXCEPT choosing where to
    /// stand, settling the session's realm and starting an arena run -- which
    /// is exactly the part a splitter's second body must not repeat.
    Entity createPlayerBody(Session&, Realm, Vec2 position);
    void despawnPlayer(Session&, bool persist);
    /// Queues a player body's destruction together with everything it put
    /// into the world: its petals AND the pets its eggs hatched. Every path
    /// that takes a body away goes through here -- a pet left behind keeps a
    /// dangling owner and wanders for good.
    void destroyBody(Entity body);
    /// Which realm this session's next body belongs in, from its spawn choice.
    Realm spawnRealmFor(const Session&) const;
    /// The door the session's spawn choice names, or null for the default and
    /// for the two realms that have no map. A door a map marks `pickable:
    /// false` only resolves for an admin session: everyone else reaches one
    /// through a pad.
    const SpawnChoice* chosenDoor(const Session&) const;
    /// Tells a client which map its body is standing on now: the arrival
    /// point and the realm's whole tile grid. Resets the server-side view so
    /// everything in reach is restated from first sight.
    void sendRealmChange(Session&, Vec2 position);
    /// The account state a session's body plays with: the arena run's scratch
    /// record while there is one (see Session::arena), else the real account.
    /// Every inventory and loadout handler goes through here, which is what
    /// keeps a run in the ring from ever touching what the player owns.
    PlayerRecord& liveRecord(Session&);
    /// Builds the scratch account an arena run plays on: the fixed starter
    /// ring, nothing in the bag, no talents, the real level.
    std::unique_ptr<PlayerRecord> startArenaRun(const PlayerRecord& account) const;
    /// Ends an arena run: a quarter of what was looted in the ring reaches the
    /// real account and the scratch record is dropped.
    void endArenaRun(Session&);
    /// A flower died in the ring: its score and its whole arena bag go to the
    /// flower that killed it, if that was another arena player.
    void settleArenaDeath(Session& victim, Entity killer);
    /// Copies the live entity's progress back onto the account record. Called
    /// on leave, on death, and periodically -- a crash must not cost a session
    /// of progress.
    void persistPlayer(const Session&);
    /// Writes the account's stats, tree and loadout onto a body that already
    /// exists. Deliberately NOT a spawn: it must not heal, protect or reload
    /// anything, because it also runs on every loadout edit and talent
    /// purchase, including one sent from the death screen.
    void applyAccountToEntity(const PlayerRecord&, Entity);
    /// The same, onto EVERY body this session owns.
    ///
    /// The four handlers that change what the account is -- a loadout edit, a
    /// swap, a talent purchase, a reset -- go through here rather than writing
    /// session.entity, because a splitter gives one account two bodies. An
    /// edit that reached only the steered half would leave the other one
    /// wearing the previous ring until it was switched to, which is the shape
    /// the browser build's per-body loadout clone turned into a duplication
    /// bug (see src/server/connection/inventory.ts's splitState block).
    void applyAccountToSession(Session&);
    /// Credits the mob kills from this tick to every player who earned loot
    /// rights on the corpse: the gallery ledger, and the stars a mythic-or-
    /// better kill is worth.
    void bankKills();
    /// Broadcasts the "has been defeated by" line a super, unique or apex kill
    /// earns, credited to the top damage dealer on the corpse. `ranked` is the
    /// same damage-sorted ledger bankKills() paid the bounty out of; with no
    /// player to credit the line is just "has been defeated!". A summon (Pet)
    /// is never announced.
    void announceBossDefeat(Entity mob, const MobType&,
                            const std::vector<Bounty::Share>& ranked);
    /// The world half of a yggdrasil revival has already happened when this is
    /// called; the SESSION half is here -- a body whose death was announced
    /// needs that announcement retracted, or its next death is silent, and the
    /// client that was told the body died has to be told it stood back up or
    /// it keeps the death card over a flower it will not steer.
    void onPlayerRevived(Entity revived, Entity reviver);

    /// Every mob body in `realm`, as the discs a spawn point has to clear. One
    /// realm's, because a spawn is judged crowded by what stands on ITS map,
    /// not by a mob at the same numbers on another. Rebuilt per call: a spawn
    /// is rare and the alternative is a cache that has to be kept true.
    void collectSpawnBlockers(Realm realm, std::vector<MobDisc>& out) const;

    /// Drains the spawner's boss queue into chat. Worded per recipient: a
    /// player standing in the boss's own section is told it spawned, everyone
    /// else that it spawned "somewhere".
    void announceBossSpawns();

    Session* sessionFor(net::ConnectionId id);
    Session* sessionForEntity(Entity e);

    /// The biome a realm belongs to.
    ///
    /// One realm is one map, and a map states its biome (defaulting to its own
    /// id), so this is the map's answer -- not the per-door `biome` the title
    /// screen files its buttons under, which is a property of a BUTTON and
    /// says nothing about where a body standing on the map is. The two
    /// generated realms answer with their own picker ids, so the ring and the
    /// maze are each a biome of their own.
    ///
    /// This is the unit a squad may not span and the unit bots are spread
    /// evenly over. Empty for a realm no map was staged for.
    std::string biomeOfRealm(Realm) const;
    /// What the spawn picker calls a biome -- the label on its door, so a
    /// refusal says "Desert" where the button says "Desert". Falls back to the
    /// raw id for a biome with no pickable door.
    std::string biomeLabel(const std::string& biome) const;
    /// The biome the body of `entity` is standing in, or empty.
    std::string biomeOfEntity(Entity) const;

    /// Moves a body -- and its whole kit -- into another realm, and tells its
    /// client which map it is now standing on.
    ///
    /// This is what a teleporter does, and it is deliberately NOT
    /// teleportEntity(): that one moves a body inside its own realm and can
    /// stay silent because the client's own snap-distance rule covers it.
    /// Crossing realms changes which grid is under the body, which nothing on
    /// the client can infer. A pad whose target is the realm the body is
    /// already in takes the silent path: same grid, nothing to resend.
    void moveEntityToRealm(Entity, Realm, Vec2 position);

    // -- bots --------------------------------------------------------------
    //
    // A world with one flower in it is not the game the reference serves: it
    // tops the population up to ~23 with server-owned flowers that fight,
    // wander and die like anyone else. They are ordinary player entities with
    // no Session behind them, which is what makes every system -- combat,
    // loot eligibility, replication, the death reaper -- treat them as players
    // without knowing they exist.
    struct Bot {
        Entity entity = NULL_ENTITY;
        std::string name;
        /// This bot's own identity, separate from its name: its persona, its
        /// strafe direction, its slot in a raid ring and which patch of ground
        /// it gravitates to. A bot has no id string here, so it is given a
        /// number at creation and keeps it across every death -- two bots that
        /// happen to share a NAME still play differently.
        std::uint32_t id = 0;
        /// The realm this bot lives in, mirrored off its body.
        ///
        /// Bots are spread evenly over the biomes, so "the overworld" is no
        /// longer an answer the controller may assume: every terrain
        /// question, every broadphase query and every index below is asked
        /// about THIS realm. A bot never changes realm -- it is rebuilt in
        /// the one it was assigned, life after life -- so this is settled at
        /// birth and only re-read to keep it honest.
        Realm realm = Realm::Overworld;
        /// Wall-clock at which a dead bot's body is replaced. A corpse that
        /// respawns instantly reads as a flower that never died.
        double respawnAtMillis = 0;
        /// Whether this body's death has already been put on the wire. A bot
        /// corpse LINGERS -- bots revive each other -- so the reaper meets it
        /// on every tick until it is replaced, and the kill event must be sent
        /// exactly once. Cleared when the body comes back up, or a yggdrasil
        /// revival would leave the next death silent.
        bool deathAnnounced = false;
        BotAiState ai;
    };

    void maintainBots(double nowMillis);
    void stepBots(double nowMillis);
    /// Builds one bot body: every component a flower needs, plus the level and
    /// loadout the NAME seeds -- so a bot called "m28" is the same build every
    /// time it appears, exactly as it is in the reference.
    Entity createBotBody(const std::string& name, Realm realm, Vec2 spawn);
    void destroyBot(Bot& bot);
    /// How removable a bot is; higher goes first. Squared distance to the
    /// nearest human, so an unwatched bot on the far side of the map is
    /// retired before one a player is standing next to. Only ever compared
    /// BETWEEN BOTS OF ONE BIOME: every biome is empty of humans most of the
    /// time, so ranking across them would retire whole biomes first and undo
    /// the spread the spawn balance just built.
    double cullScore(const Bot& bot) const;
    /// Where a bot appears, in `realm`. Collects the mob bodies a candidate
    /// must be clear of, which is a walk over every mob in the world -- so a
    /// caller placing SEVERAL bots must collect once and use the overload
    /// below, or a large `set_bot_count` pays that walk per bot and lands as
    /// a tick spike.
    Vec2 pickBotSpawn(Realm realm);
    Vec2 pickBotSpawn(Realm realm, const std::vector<MobDisc>& blockers);

    /// The biomes bots are spread over, each as the realms it owns.
    ///
    /// Every biome a PLAYER can join from the title screen AND could live in,
    /// and only those. A bot standing somewhere no door leads is a bot in a
    /// place the game does not offer; a bot posted to ground nothing can
    /// survive on is a corpse on a three-second timer. See realmHoldsBots().
    /// Cached -- the maps do not change while the server runs.
    struct BotBiome {
        std::string name;
        std::vector<Realm> realms;
    };
    const std::vector<BotBiome>& botBiomes() const;
    /// Whether a realm has ground a standing population could live on: one
    /// spawn band that is neither dangerous nor a single creature's range.
    /// What keeps the bots out of Hel, by what its map SAYS rather than by
    /// its name.
    bool realmHoldsBots(Realm) const;
    /// Which realm the next bot is born in: a realm of whichever biome holds
    /// the fewest bots right now, so the population stays level across the
    /// map however bots die, respawn and are culled. Overworld when no biome
    /// has a door at all, which is every in-memory test world.
    Realm pickBotRealm();
    /// Which entry of botBiomes() a realm belongs to, or botBiomes().size()
    /// for a realm no listed biome owns -- the arena, the maze, and every
    /// map with no door into it.
    std::size_t botBiomeBucket(Realm) const;
    /// How many bots belong to each entry of botBiomes(), plus a last bucket
    /// for the ones that belong to no listed biome. Counted by the realm the
    /// bot was ASSIGNED, so a bot waiting on a respawn still holds its seat.
    void countBotsPerBiome(std::vector<int>& out) const;
    /// The roster entry owning this body, or null. How the reaper tells a bot
    /// apart from a flower whose connection went away: neither has a session.
    Bot* botForEntity(Entity);

    // -- bot AI ------------------------------------------------------------
    //
    // All of this is server/bot_ai.cpp, whose header explains the shape: one
    // sensing pass per tick, then an activity machine that holds whatever it
    // chose for at least a dwell period. server/bot_ai.h carries the tuning.

    /// One bot's decision for this tick, written into its PlayerInput.
    void stepOneBot(Bot&, double nowMillis);

    /// Everything one bot can see this tick, gathered in ONE broadphase query
    /// so that the decision and the steering cannot disagree about what is in
    /// the world -- which is exactly how the old controller ended up walking
    /// bots through mobs its targeting had filtered out.
    struct BotSenses {
        Vec2 at;
        double bodyRadius = kPlayerBaseRadius;
        double healthRatio = 1.0;
        /// The distance at which this bot's petals connect, at full attack
        /// extension. The whole combat controller is built on it.
        double reach = 0;

        /// The best thing to fight, already through the notice ranges, the
        /// leash and the stickiness bonus.
        Entity target = NULL_ENTITY;
        double targetDist = 0;
        double targetRadius = 0;
        bool targetIsBoss = false;

        /// A mob close enough that carrying on would walk into it. Always
        /// worth engaging, whatever the bot thought it was doing -- it is
        /// scored so far above everything else that it becomes `target`, which
        /// is why nothing below needs its distance.
        Entity blocker = NULL_ENTITY;

        /// The nearest mob actively hunting this bot, and the nearest drop.
        Entity threat = NULL_ENTITY;
        Entity pickup = NULL_ENTITY;

        /// How many live mobs were in sense range at all. What tells a bot its
        /// patch has gone barren and it is time to move on.
        int mobsInRange = 0;
    };
    void botSense(Bot&, double nowMillis, BotSenses& out);

    /// Picks and maintains the patch of ground a bot works.
    ///
    /// Bots are company, so a patch is chosen in a band a human is standing in
    /// -- far enough out not to crowd them, and spread over the band, which is
    /// stocked whole whoever stands in it (systems/spawning.h). With nobody on
    /// the bot's map it falls back to a spawn band suited to the bot's gear,
    /// so a joining player arrives into a world that already looks inhabited.
    void botUpdateHome(Bot&, double nowMillis, const BotSenses&);
    bool botPickHuntingGround(const Bot&, Vec2& out);

    /// The activities. Each one writes the bot's input and nothing else.
    void botFight(Bot&, const BotSenses&, double nowMillis);
    void botHunt(Bot&, const BotSenses&, double nowMillis);
    void botLoot(Bot&, const BotSenses&, double nowMillis);
    void botRetreat(Bot&, const BotSenses&, double nowMillis);
    void botTravel(Bot&, const BotSenses&, double nowMillis, Vec2 goal);
    void botRoam(Bot&, const BotSenses&, double nowMillis);
    void botRevive(Bot&, const BotSenses&, double nowMillis, Entity downed);

    /// Moves a bot into a new activity, resetting whatever the old one owned.
    void botEnter(Bot&, BotActivity, double nowMillis);

    /// Per-tick indexes, built once for the whole pass rather than per bot.
    void rebuildBotBossIndex(double nowMillis);
    /// A coarse count of where the mobs are standing, one grid per realm.
    ///
    /// A bot sees kBotSenseRadius and no further, so left to itself it picks
    /// somewhere to work by geometry and finds out whether anything lives
    /// there by walking to it. Measured, that is most of the population
    /// wandering most of the time. This is the part a player has that a bot
    /// does not -- a sense of where the action is -- and it is one pass over
    /// the mobs per tick rather than a query per bot.
    ///
    /// One grid per realm that has a bot in it, and none for the rest: a
    /// single grid would have every biome's mobs voting on where a bot in one
    /// of them should work.
    void rebuildBotMobHeat();
    int botMobHeatAt(Realm, Vec2) const;
    void computeBotRaidSlots(double nowMillis);
    void updateBotSquads(double nowMillis);
    /// Tells the bot controller that a boss has just appeared.
    ///
    /// The other half of announceBossSpawns: the same event that puts a line
    /// in everybody's chat also reaches the bots, and it reaches them from the
    /// SPAWNER rather than from whatever the per-tick index happened to
    /// notice, so a boss from any path at all -- a band stocking itself, a
    /// nest, the arena, an operator's console -- is one the bots know about
    /// and know the age of. Without it a boss is only ever discovered by the
    /// index sweep, which cannot tell a mob that spawned this tick from one
    /// that has been standing there since the server came up.
    void noteBossSighting(Entity boss, double nowMillis);
    /// Bots call fresh super/unique sightings out in chat, which is also what
    /// rallies the population onto one. Spawn alerts are worked through first,
    /// oldest first, so what the bots shout about is what actually just
    /// happened.
    void announceNewBosses(double nowMillis);
    /// Rallies every bot onto the best boss in the world (unique over super,
    /// then most recently seen, then closest to a human). Returns whether one
    /// was found; the chat handler answers the player either way.
    bool triggerBotRaid(double nowMillis);
    /// The rally point bots IN `realm` are currently pulled toward, if any. A
    /// rally is one boss in one biome; the bots working the others carry on.
    bool activeForcedRaidAnchor(double nowMillis, Realm realm, Vec2& out);
    /// The nearest boss within rally range of this bot, preferring uniques.
    bool botNearestBoss(const Bot&, Vec2& out, double& distOut);
    /// The one rule the three raid picks above share: among the live supers
    /// and uniques in botBosses_ -- apex never rallies anybody -- a unique
    /// beats every super, then the most recently seen wins, then, when
    /// `humanTieBreak`, the one closest to a human. `realm` keeps only that
    /// realm's bosses, and `within` only those inside kBotBossRallyRange of a
    /// point. NULL_ENTITY when nothing qualifies.
    Entity bestRaidBoss(std::optional<Realm> realm, std::optional<Vec2> within,
                        bool humanTieBreak) const;

    // -- bot movement primitives -------------------------------------------

    /// Writes the finished heading into the bot's input: separation from other
    /// bots, repulsion from the mobs it is NOT engaging, the turn-rate limit,
    /// and the petal state.
    ///
    /// `avoidStrength` is how hard the mob repulsion pushes, which differs by
    /// what the bot is doing -- see kBotAvoidStrengthTravel/Fight.
    void botDrive(Bot&, Vec2 direction, double speedMultiplier, double avoidStrength,
                  double agility = 1.0, Entity engaging = NULL_ENTITY);
    /// Stands still. Petal state is left to the caller's last request.
    void botHold(Bot&);
    /// Extends or retracts the ring, with a hold so it cannot flicker.
    void botSetPetals(Bot&, bool out, double nowMillis, bool defending = false);

    /// The reference's sampled raycast. Deliberately not the terrain's exact
    /// swept test: this one steers through the diagonal seams and narrow gaps
    /// the exact one refuses, which is where bots are willing to walk.
    bool botRayHitsWall(Realm, Vec2 from, Vec2 to) const;
    /// Rotates a heading to the first probe offset with no wall in it.
    Vec2 botSteerAroundWalls(Realm, Vec2 from, Vec2 direction,
                             double probeDistance = kTileSize * 1.2) const;
    /// A steering bias away from every nearby mob except the one being fought.
    Vec2 botAvoidMobs(Realm, Vec2 at, Entity except, Vec2 heading,
                      double sidePreference = 1.0);
    /// Watches for the one unambiguous fault: a bot asking to move and not
    /// moving. Returns true while an escape manoeuvre is running.
    bool botHandleStuck(Bot&, double nowMillis);

    /// Follows a cached A* path toward `goal`, recomputing when it goes stale
    /// and smoothing it against line of sight. False when there is no usable
    /// path, which is the caller's cue to steer directly.
    bool botFollowPath(Bot&, double nowMillis, Vec2 goal, double speedMultiplier,
                       double avoidStrength, Entity engaging = NULL_ENTITY);
    bool botFindPath(Realm, Vec2 start, Vec2 goal, std::vector<Vec2>& out);
    void botClearPath(BotAiState&);
    int botStrafeDirection(Bot&, double nowMillis);

    /// The closest downed bot worth diverting to revive, or NULL_ENTITY.
    Entity botFindReviveTarget(const Bot&) const;
    bool botHasNearbyBuddy(const Bot&, double range) const;

    // -- bot loadout swaps -------------------------------------------------

    void botEquipPowder(Bot&);
    void botUnequipPowder(Bot&);
    void botEquipYggdrasil(Bot&);
    void botUnequipYggdrasil(Bot&);

    // -- bot reach ---------------------------------------------------------

    /// The farthest a petal edge can be from this bot's centre, plus the
    /// standoff buffer. Derived from the ring's own geometry rather than
    /// copied from it: a hand copy that drifts does not fail, it just parks
    /// the bot outside the range its petals actually reach.
    double botPetalReach(const Bot&, double petalExtension) const;
    /// Highest petal rarity across the bot's active row, which is what decides
    /// the ground it wants to farm.
    int botMaxRarityIndex(const Bot&) const;
    /// The best tier anything on this map actually spawns at.
    ///
    /// A bot's standards are relative to its gear, and a bot geared past
    /// everything the world contains would otherwise have standards no mob can
    /// meet and walk past the lot. Resolved once from the maps' bands; the
    /// staged set does not change while the server is up.
    int botMapTierCeiling() const;
    mutable int botMapCeiling_ = -1;

    // -- tick phases -------------------------------------------------------
    void runSystems(double nowMillis, double dt);

    /// Moves what the loot system handed out into the owning accounts.
    void bankPickups();
    void replicate(double nowMillis);
    void reapDead();

    ServerConfig config_;
    std::atomic<bool> running_{false};
    /// Written once, on the way out, by whatever asked the server to stop.
    /// See exitCode().
    int exitCode_ = 0;

    World world_;
    CommandBuffer commands_{world_};
    std::unique_ptr<Terrain> terrain_;
    /// Every staged map: where a joining player may be put down, what lives on
    /// each stretch of ground, and which pad leads to which other map. The
    /// realm an entity is in is the index into this.
    WorldMaps worldMaps_;
    SpatialGrid grid_;
    Rng rng_;
    /// The bots' OWN stream, separate from the world's.
    ///
    /// A controller that draws from rng_ decides what every other system rolls
    /// as well: change how often a bot pauses and the arena's crowd lands
    /// somewhere else, a drop table comes up differently, and a test that
    /// pinned any of it fails for a reason that has nothing to do with what
    /// changed. Bots are the most-tuned thing on the server, so they get their
    /// own stream and the world's rolls stop moving underneath them.
    Rng botRng_;

    Database database_;
    /// Registration and login limits, keyed on the peer address rather than on
    /// the session -- a session is a socket, and a socket is free. See
    /// server/account_limits.h.
    AccountLimiter accountLimits_;
    net::Listener listener_;

    /// Guild invitations waiting on an answer, keyed by the lower-cased
    /// invitee. In memory only and one deep per player, exactly as the
    /// reference's `pendingGuildInvites` is: an invitation is a conversation,
    /// not a record.
    struct PendingGuildInvite {
        std::string guildName;
        std::int64_t expiresAtMillis = 0;
    };
    std::unordered_map<std::string, PendingGuildInvite> guildInvites_;
    /// What serviceGuildPresence last saw: every authenticated account, keyed
    /// by lower-cased username, mapped to its guildLocation().
    std::unordered_map<std::string, std::string> guildPresence_;
    double nextGuildPresenceMillis_ = 0;

    SquadRoster squads_;
    /// The flattened form the loot and XP rules read, rebuilt each tick.
    SquadEntityIndex squadIndex_;

    /// Admin consoles lent to players who are not database admins.
    ///
    /// Keyed by connection and held in memory only: a grant is for one life,
    /// so there is nothing here worth surviving a restart. See
    /// revokeTempAdmin() for every way one ends.
    struct TempAdminGrant {
        std::string grantedBy;
        double grantedAtMillis = 0;
    };
    std::unordered_map<net::ConnectionId, TempAdminGrant> tempAdmins_;
    std::string adminDbKey_;

    /// `/admin set_bot_count`'s override, or -1 for the default formula.
    /// Negative rather than optional because -1 is already what "no override"
    /// means everywhere this is read.
    int botCountOverride_ = -1;

    std::unordered_map<net::ConnectionId, Session> sessions_;
    std::unordered_map<net::ConnectionId, ClientView> views_;

    NetIdAllocator netIds_;
    Replicator replicator_;
    EventQueue events_;

    std::unique_ptr<MovementSystem> movement_;
    std::unique_ptr<MobAiSystem> mobAi_;
    std::unique_ptr<PetalSystem> petals_;
    std::unique_ptr<CombatSystem> combat_;
    std::unique_ptr<SpawnSystem> spawning_;
    /// The arena's crowd and the maze's corridors, populated whole.
    std::unique_ptr<ModeSpawner> modes_;
    /// The nests a flower walks into, and the private copies they lead to.
    std::unique_ptr<DungeonSystem> dungeons_;
    std::unique_ptr<LootSystem> loot_;
    /// The friendly NPCs the maps place, and who each one is looking at.
    std::unique_ptr<NpcSystem> npcs_;
    /// When each account may next buy from an oracle, on clockMillis_, keyed
    /// by userId. Server memory ONLY -- never written to the database -- so a
    /// restart forgets every wait, which is what makes the half hour easy to
    /// test past. Keyed by account rather than connection, so a relog does not.
    std::unordered_map<std::string, double> oracleReadyAt_;
    /// When each account may next trade, the same way: memory only, by userId.
    std::unordered_map<std::string, double> traderReadyAt_;
    /// Who holds each petal at universal, as last found or forged, and when
    /// (clockMillis_). See kTitanHolderMemoMillis.
    struct HolderMemo {
        std::string username;
        double atMillis = 0;
    };
    std::unordered_map<std::uint16_t, HolderMemo> universalHolders_;

    /// Positions of every live flower, bots included, each with the realm it
    /// stands in, rebuilt each tick. The mob LOD counts a bot as an observer,
    /// so this is the list it gets.
    std::vector<RealmPoint> activePlayers_;
    /// The same, restricted to real connections: what ModeSpawner fills the
    /// arena and the maze for, which a bot has no business keeping populated.
    /// The band spawner, the mob LOD and the NPCs take activePlayers_, bots
    /// included (see runSystems).
    std::vector<RealmPoint> humanPlayers_;

    std::vector<Bot> bots_;
    /// The biomes bots are spread over, resolved from the staged maps once.
    mutable std::vector<BotBiome> botBiomes_;
    mutable bool botBiomesReady_ = false;
    /// Scratch for the population balance, so picking a birthplace allocates
    /// nothing on a maintenance pass.
    mutable std::vector<int> botBiomeCounts_;
    /// Where the humans are standing, collected once per bot pass. Bots leave
    /// the mobs around a real player alone (kBotPlayerClaimRadius), and asking
    /// the session table per candidate mob per bot per tick would be a walk
    /// over it a few thousand times a second. With realms: a human in the
    /// desert claims nothing from a bot in the garden.
    std::vector<RealmPoint> botHumanSpots_;
    /// The heat grid rebuildBotMobHeat() fills, in kBotHeatCellSize cells --
    /// one per realm that has a bot in it, empty for the rest.
    struct BotHeatGrid {
        std::vector<std::uint16_t> cells;
        int cols = 0;
        int rows = 0;
    };
    std::vector<BotHeatGrid> botMobHeat_;
    /// Broadphase scratch for the bot controller, reused so a per-tick scan
    /// over two dozen bots does not allocate two dozen times.
    std::vector<Entity> botCandidates_;
    /// A second one, for the queries that run from INSIDE a decision that is
    /// still holding results from the first (mob avoidance runs while the
    /// combat controller holds its target's row).
    std::vector<Entity> botAvoidCandidates_;
    /// The world's boss-tier mobs, collected once per bot pass. A boss draws
    /// bots in from four thousand units away and asking the broadphase for that
    /// radius once per bot would query most of the map two dozen times a tick.
    std::vector<Entity> botBosses_;
    /// When each live boss was first seen, which is what "most recently
    /// spawned" means to a raid picker. The reference reads a spawn timestamp
    /// off the mob; nothing here carries one, and first sight is within a tick
    /// of the spawn because this pass runs every tick.
    std::unordered_map<Entity, double> botBossFirstSeen_;
    /// Bosses that have already been called out, so one is not announced twice.
    std::unordered_map<Entity, bool> botAnnouncedBosses_;
    /// Scratch for one callout pass: the alerts, then the standing index.
    std::vector<Entity> botCalloutQueue_;
    /// Bosses the spawner reported this tick or recently, oldest first.
    ///
    /// Small and bounded: a callout is on a minute-long cooldown, so this is a
    /// short queue of what to shout about next, not a log. Entries are dropped
    /// when the boss dies before its turn comes round.
    std::vector<Entity> botBossAlerts_;
    /// Suppresses a burst of callouts for the bosses that were already alive
    /// when the first pass ran.
    bool botBossAnnounceReady_ = false;
    double botNextBossAnnounceMillis_ = 0;

    /// The chat-triggered rally: every bot converges on this point regardless
    /// of distance until it lapses or its boss dies.
    struct BotForcedRaid {
        bool active = false;
        Vec2 at;
        /// Which biome's bots are being called. A rally is one boss standing
        /// in one map, and the bots in the others cannot walk to it: without
        /// this they march to the same COORDINATES in their own realm, which
        /// is a crowd of flowers standing on an empty field.
        Realm realm = Realm::Overworld;
        double untilMillis = 0;
    };
    BotForcedRaid botForcedRaid_;

    /// The angular slot each raider owns around its rally point, so a raid
    /// spreads around a boss instead of stacking on one side of it, and how
    /// wide the crowd it belongs to should stand. Rebuilt once per pass rather
    /// than per bot.
    ///
    /// The width is sized off the RAIDER COUNT: twenty flowers rallying into a
    /// circle a few body-widths across spend the whole fight shoving each
    /// other, and the shoving is what reads as a crowd of bots vibrating.
    struct BotRaidSlot {
        double angle = 0;
        double crowdRadius = kBotRaidRingMin;
    };
    std::unordered_map<Entity, BotRaidSlot> botRaidSlots_;

    /// A* scratch per realm. The tables are indexed by tile, so they are
    /// sized to one map's grid; sharing one across realms of different
    /// dimensions would reallocate and clear it on every search that crossed
    /// a biome boundary.
    std::vector<BotPathScratch> botPath_;
    /// How many A* recomputes are left this tick. A whole raid replanning
    /// together would otherwise spike the frame.
    int botPathBudget_ = 0;
    /// Wall-clock of the last tick with a human in the world. Bots outlive an
    /// empty server by a grace period so a quick reconnect does not land in a
    /// world that was just emptied.
    double lastHumanSeenMillis_ = 0;
    double nextBotMaintainMillis_ = 0;
    double nextBotJitterMillis_ = 0;
    int botCountJitter_ = 0;

    /// When the next fixed step is due, in the monotonic clock. A member
    /// rather than a local in run(), because the loop is no longer
    /// necessarily this object's.
    double nextTickMillis_ = 0;
    /// Simulation delta, low-pass filtered over the real elapsed time between
    /// ticks and clamped to three nominal steps.
    ///
    /// Driving the dt-scaled half off a constant 1/30 makes a flower's real
    /// speed scale with however fast the server is actually ticking, so it
    /// crawls under load; feeding the raw sample straight in makes each tick
    /// advance an uneven amount and the flower stutters. The filter keeps the
    /// speed honest and the motion smooth, and the clamp keeps a long stall
    /// from producing one giant step.
    ///
    /// Only step() writes it, so a test driving tick() by hand still gets an
    /// exactly fixed step.
    double smoothedDeltaSeconds_ = net::kTickSeconds;
    double lastTickWallMillis_ = 0;

    /// How long tick() itself took, drained once a second into a DebugStats
    /// broadcast. The mean says what the server costs at rest; the worst
    /// single tick of the window is the one that shows up as a stutter, and
    /// averaging it away would hide exactly the thing the graph is for.
    double debugTickAccumMillis_ = 0;
    double debugTickMaxMillis_ = 0;
    int debugTickSamples_ = 0;
    double nextDebugStatsMillis_ = 0;

    /// Where the current tick's time went: tick() stamps the end of each of
    /// its phases here. A tick past kSlowTickLogMillis turns the stamps into
    /// one log line naming the phases that cost something, so a spike on a
    /// live server says what it was without a profiler attached. Only the
    /// worst slow tick of each second is printed -- an overloaded server
    /// would otherwise write thirty lines a second to a small disk.
    struct TickPhase {
        const char* name;
        double endedMillis;
    };
    void markTickPhase(const char* name);
    std::string describeTickPhases(double tookMillis) const;
    std::array<TickPhase, 24> tickPhases_{};
    std::size_t tickPhaseCount_ = 0;
    double tickStartedMillis_ = 0;
    double slowTickWorstMillis_ = 0;
    std::string slowTickLine_;

    /// When the next snapshot is due. The wire runs slower than the
    /// simulation: physics wants 30 Hz resolution, clients do not, and the
    /// per-recipient encode/cull/delta pass is the most expensive thing in the
    /// tick that nothing simulated depends on.
    double nextSnapshotMillis_ = 0;
    /// Counts snapshots actually sent, which is what the far-band update
    /// cadence is staggered against (Replicator::farSnapshotStride).
    std::uint32_t snapshotIndex_ = 0;

    /// The clock every deadline this class owns is measured against: the
    /// `nowMillis` the last tick was given.
    ///
    /// NOT monotonicMillis() directly. tick() is handed its time by the caller
    /// -- run() passes the monotonic clock, a test passes a synthetic one --
    /// and a squad invite stamped from one clock while the expiry sweep reads
    /// the other is an invite that never lapses, or one that lapses at once.
    double clockMillis_ = 0;

    std::uint32_t tick_ = 0;
    double nextPersistMillis_ = 0;

    /// The boss clocks as persistBossClocks last wrote them, on clockMillis_,
    /// so an unchanged clock costs a compare rather than a table write.
    struct SavedBossClock {
        std::string biome;
        double uniqueReadyMillis = 0;
        double apexReadyMillis = 0;
    };
    std::vector<SavedBossClock> savedBossClocks_;
    bool bossClocksRestored_ = false;
    ByteWriter scratch_;

    /// One line broadcastChat sent, kept for sendChatHistory.
    struct ChatHistoryLine {
        net::ChatChannel channel = net::ChatChannel::Global;
        std::string author;
        std::string text;
        std::int64_t sentAtMillis = 0;   ///< Unix time, Database::nowMillis
    };
    /// The last lines said to everyone, oldest first. Only broadcastChat
    /// feeds it: a squad or guild line, or a reply to one player's command,
    /// was never everybody's to replay. Memory only -- a restart starts the
    /// room over, as it does for the players in it.
    std::deque<ChatHistoryLine> chatHistory_;
    /// The client's own transcript cap (NetClient::kMaxChatLines): a longer
    /// backlog would be sent only to be trimmed off on arrival.
    static constexpr std::size_t kChatHistoryLines = 100;
};

} // namespace flix
