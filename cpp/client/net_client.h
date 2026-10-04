#pragma once
// The client's connection to a server.
//
// Owns the socket, the handshake, and the mapping from server messages to
// client state. Everything it learns lands in a WorldView or in one of the
// fields below; nothing in the renderer talks to a socket.

#include <array>
#include <cstdint>
#include <deque>
#include <string>
#include <unordered_map>
#include <vector>

#include "client/chat_bubbles.h"
#include "client/world_view.h"
#include "shared/game/config.h"
#include "shared/game/skin_format.h"
#include "shared/game/skills.h"
#include "shared/game/terrain.h"
#include "shared/net/admin_db.h"
#include "shared/net/protocol.h"
#include "shared/net/transport.h"

namespace flix {

class WorldMaps;

/// The account state the server sends after login, and keeps up to date.
struct Profile {
    std::string username;
    double totalXp = 0;
    int level = 1;
    double stars = 0;   ///< see PlayerProgress::stars

    struct Stack {
        std::uint16_t petalIndex = 0;
        Rarity rarity = Rarity::Common;
        std::uint32_t count = 0;
    };
    std::vector<Stack> inventory;

    struct Slot {
        std::uint16_t petalIndex = 0xFFFF;
        Rarity rarity = Rarity::Common;
        bool empty() const { return petalIndex == 0xFFFF; }
    };
    std::vector<Slot> loadout;

    /// The cosmetic bit currently worn, or PlayerRenderNone.
    std::uint32_t renderFlags = 0;

    SkillSet skills;

    /// Kills per mob and tier, flattened as `mobIndex * kRarityCount + tier`.
    /// A dense grid rather than a map: the gallery reads every cell of it once
    /// per frame, and there are only a few hundred.
    /// Milliseconds the account still had to wait for its next oracle craft
    /// when this profile was sent; 0 when it may craft now. A duration, not a
    /// deadline: NetClient turns it into one on its own clock as it arrives.
    std::uint32_t oracleCooldownMillis = 0;
    /// The same for the account's next trade at a trader.
    std::uint32_t traderCooldownMillis = 0;
    std::vector<std::uint32_t> mobKills;

    /// The saved loadouts, by preset number (loadoutPresetName), each in
    /// `loadout`'s shape. Empty for a preset never saved.
    std::array<std::vector<Slot>, kLoadoutPresetCount> presets;

    std::uint32_t killCount(std::uint16_t mobIndex, Rarity rarity) const {
        const std::size_t at = static_cast<std::size_t>(mobIndex) * kRarityCount + rarityIndex(rarity);
        return at < mobKills.size() ? mobKills[at] : 0;
    }

    /// Unspent talent points. Derived from the level exactly as the server
    /// derives it, so the panel never shows a balance the server would refuse.
    int talentPoints() const { return availableTalentPoints(level, skills); }

    /// How many of one petal at one tier the account holds.
    std::uint32_t stackCount(std::uint16_t petalIndex, Rarity rarity) const {
        for (const Stack& stack : inventory) {
            if (stack.petalIndex == petalIndex && stack.rarity == rarity) return stack.count;
        }
        return 0;
    }
};

/// One row of the account leaderboard.
struct LeaderboardRow {
    std::string name;
    int level = 1;
    double totalXp = 0;
};

/// One entry of the global notification feed.
struct NotificationEntry {
    /// The server's own id string. It is what the read set is keyed on, so it
    /// travels verbatim rather than being re-derived from the timestamp.
    std::string id;
    net::NotificationKind kind = net::NotificationKind::Generic;
    std::string message;
    /// Unix milliseconds, so "3 days ago" can be measured against a wall clock
    /// rather than against this process's uptime.
    double timestampMillis = 0;
};

/// The player's guild, as the last GuildUpdate described it.
///
/// `joined` false is the browser's `guildUpdate null`: the panel's no-guild
/// view, not merely "not fetched yet".
struct GuildState {
    struct Member {
        std::string name;
        bool online = false;
        /// The biome an online member's body is in, as the spawn picker labels
        /// it. Empty for anyone offline or without a body just now.
        std::string location;
    };

    bool joined = false;
    /// The five-character key, shown in brackets.
    std::string tag;
    /// The free-text name the card is headed with. Never empty: the server
    /// sends the tag for a guild that has none.
    std::string name;
    std::string description;
    std::string leader;
    std::vector<Member> members;

    std::size_t onlineCount() const {
        std::size_t count = 0;
        for (const Member& member : members) count += member.online ? 1 : 0;
        return count;
    }
};

/// The player's squad, as the last SquadUpdate described it.
///
/// `inSquad` false is the browser's `squadUpdate null`. The wire ids are what
/// the minimap and the party HUD find the members' bodies by; a member with no
/// body just now -- sitting on the title screen, or looking at a death card --
/// carries a zero, and both surfaces simply skip them.
struct SquadState {
    struct Member {
        std::string account;    ///< the account name, or a bot's nameplate
        std::string name;       ///< what the flower is labelled
        std::uint32_t netId = 0;
        bool leader = false;
        bool bot = false;
    };

    bool inSquad = false;
    std::string id;
    bool isPublic = false;
    std::vector<Member> members;

    /// True when `netId` belongs to a squadmate. Linear over at most four
    /// entries, which is cheaper than the set that would replace it.
    bool contains(std::uint32_t netId) const {
        if (!inSquad || netId == 0) return false;
        for (const Member& member : members) {
            if (member.netId == netId) return true;
        }
        return false;
    }
};

/// A guild invitation waiting on an answer.
struct GuildInvite {
    bool waiting = false;
    /// The tag, which is what an accept is matched against server-side.
    std::string guildName;
    std::string fromUsername;
    /// The free-text name, for the invite card to head itself with.
    std::string displayName;
    /// Raised when an invite lands, so the menu system can force the panel
    /// open once and then clear it. Separate from `waiting`, which stays set
    /// for as long as the invite is unanswered.
    bool justArrived = false;
};

/// The outcome of the last craft, for the crafting panel's result animation.
struct CraftOutcome {
    bool pending = false;      ///< a result arrived that the panel has not read
    bool success = false;
    std::uint16_t petalIndex = 0;
    Rarity rarity = Rarity::Common;
    /// How many upgrades the whole staged pool produced. The panel's result
    /// caption counts these, so a staged x3 that landed twice reads "x2".
    int crafted = 0;
    /// The sub-batch tail the pool could not spend, 0-4. The ring keeps this
    /// many slots filled when nothing was crafted.
    int petalsReturned = 0;
    std::string reason;
};

/// The outcome of the last oracle craft, for the oracle panel's pulse.
///
/// Its own record rather than a CraftOutcome: the two panels share the craft
/// key and the card, and a result either could read would land in whichever
/// one happened to be showing when it arrived.
struct OracleOutcome {
    bool pending = false;      ///< a result arrived that the panel has not read
    bool success = false;
    std::uint16_t petalIndex = 0;
    /// The tier MADE on a success; the tier offered on a refusal.
    Rarity rarity = Rarity::Common;
    /// How many upgrades were bought -- always all of them, or none.
    int crafted = 0;
    /// How many petals went in.
    std::uint32_t spent = 0;
    std::string reason;
};

/// The outcome of the last forge at a titan. Its own record for
/// OracleOutcome's reason.
struct TitanForgeOutcome {
    bool pending = false;      ///< a result arrived that the panel has not read
    bool success = false;
    /// The petal forged -- one universal of it -- or offered on a refusal.
    std::uint16_t petalIndex = 0;
    std::string reason;
};

/// The outcome of the last trade, for the trade panel's landing. Its own
/// record for OracleOutcome's reason.
struct TradeOutcome {
    bool pending = false;      ///< a result arrived that the panel has not read
    bool success = false;
    /// The petal offered, and its tier -- which is also the coin's tier.
    std::uint16_t petalIndex = 0;
    Rarity rarity = Rarity::Common;
    /// What came back for it; kNoPetal on a refusal.
    std::uint16_t receivedIndex = kNoPetal;
    std::string reason;
};

/// The shop's own reply channel: what came back from a purchase or a code.
///
/// Separate from the notice stream because the reference answers both in a
/// modal on the shop card -- "Purchase failed: ..." / "Code redemption failed:
/// ..." -- and a chat line is not that.
struct ShopOutcome {
    bool pending = false;      ///< a result arrived that the panel has not read
    bool redeem = false;       ///< false for a purchase
    bool ok = false;
    double stars = 0;          ///< what a redeemed code paid
    std::string message;
};

/// The settings panel's change-password reply, read the way ShopOutcome is:
/// the answer belongs on the form that asked, and a chat line is not that.
struct PasswordOutcome {
    bool pending = false;   ///< a result arrived that the panel has not read
    bool ok = false;
    std::string message;
};

/// One row of the database editor's account list.
struct AdminDbAccountRow {
    std::string username;
    std::uint16_t level = 0;
    std::uint8_t flags = 0;   ///< net::AdminDbAccountFlags
};

/// One of the database's editable top-level tables.
struct AdminDbTableRow {
    std::string name;
    bool isArray = false;
    std::uint32_t entries = 0;
};

/// What the admin database editor knows: the account list it last asked for,
/// the tables, the ONE document it has open, and how the last edit went.
///
/// Kept here rather than in the panel because the answers arrive whether or
/// not the panel is drawing, and because `/admin db` has to open the panel
/// from a chat line. The server sends none of it to anyone the database does
/// not flag as an admin, so for everybody else this stays empty.
struct AdminDbState {
    /// Raised by the server's answer to `/admin db`. The menu system opens the
    /// panel once and clears it, as a guild invitation does.
    bool openRequested = false;
    /// The account `/admin db <name>` named. The panel opens it and clears it.
    std::string openUsername;

    /// The query the rows below answer, and how many accounts matched it --
    /// more than `accounts` holds until every page has been asked for.
    std::string listSearch;
    std::uint32_t listTotal = 0;
    std::vector<AdminDbAccountRow> accounts;
    bool listPending = false;

    std::vector<AdminDbTableRow> tables;

    /// The open document. `root` is meaningful once `loaded`.
    bool documentOpen = false;
    net::AdminDbScope scope = net::AdminDbScope::Account;
    std::string key;
    std::uint8_t flags = 0;
    bool loaded = false;
    net::AdminDbNode root;
    /// Paths asked for and not answered yet, so their rows can say so.
    std::vector<net::AdminDbPath> fetching;

    /// The last edit's or action's answer. `resultSeq` moves on every one, so
    /// the panel can tell a new answer from the one it is already showing.
    bool resultOk = true;
    std::string resultMessage;
    std::uint32_t resultSeq = 0;
    /// Moves when a document was deleted, so the list can be asked again.
    std::uint32_t goneSeq = 0;
};

struct ChatLine {
    net::ChatChannel channel = net::ChatChannel::Global;
    std::string author;
    std::string text;
    /// The flower that said it, or 0 for anything the server said in its own
    /// voice. What the bubble over a speaker's head is anchored to.
    std::uint32_t speakerNetId = 0;
    double receivedAtMillis = 0;
    /// When the line was said, in Unix milliseconds -- a backlog line's is the
    /// server's, from before this client connected. Separate from
    /// `receivedAtMillis`, which is monotonic uptime and so cannot be turned
    /// into a wall-clock time of day. The transcript no longer prints it.
    std::int64_t wallClockMillis = 0;
};

/// The daily-login streak, as the server computed it at authentication. The
/// title screen's streak card is the only reader; it counts down to the two
/// timestamps, which are Unix millis and so are comparable with the wall clock
/// rather than with the app's own uptime.
struct DailyStreak {
    /// False until an authentication has answered. The card does not paint
    /// before then, because "Day 0" is not a thing it can say.
    bool known = false;
    int streak = 0;
    /// True when this login is the one that claimed today. Latched for the
    /// session, exactly as the browser build latches it, so the card keeps its
    /// brighter star until the next login.
    bool newDay = false;
    int starsAwarded = 0;
    std::int64_t nextClaimAtMillis = 0;
    std::int64_t streakExpiresAtMillis = 0;
};

class NetClient : public net::TransportHandler {
public:
    enum class Status {
        Offline,
        Connecting,
        /// Socket up, waiting for the server to accept our protocol version.
        Handshaking,
        /// Protocol accepted; may log in.
        Ready,
        LoggedIn,
        Playing,
        Failed,
    };

    NetClient();
    ~NetClient() override;

    bool connect(const std::string& host, std::uint16_t port);
    void disconnect();
    /// Dials the server connect() was last pointed at, again. The handshake
    /// that follows counts as a reconnection, so the app resumes the session
    /// token this client is still holding.
    void redial();

    /// True while a dropped socket is waiting to be redialled.
    ///
    /// A server restart is what this exists for: the process goes away, every
    /// socket closes, and a client that did nothing about it would sit on a
    /// dead connection until somebody refreshed the page. The redial is the
    /// browser socket's own -- one second, times 1.5 per failure, capped at
    /// ten, reset the moment a handshake lands.
    bool reconnecting() const {
        // Both halves of the wait: the pause between attempts, and an attempt
        // in flight. After the first handshake there is no other reason to be
        // dialling, so a Connecting status IS a reconnection -- and without
        // this the banner's line would blink out for the length of every try.
        return retryAtMillis_ > 0 || (status_ == Status::Connecting && handshakes_ > 0);
    }

    /// Set once for every handshake AFTER the first: the socket came back.
    ///
    /// Cleared by whoever reads it, like `authAnswered`. Putting the SESSION
    /// back together is not something the socket can do for itself -- the
    /// account has to be resumed and the screen has to be steered somewhere
    /// that makes sense, and only the app knows where it was.
    bool reconnected = false;

    /// Set when the server refused the handshake: this build is not the one it
    /// is serving. Cleared by whoever reads it. See client/web/reload.h for
    /// what the browser does about it.
    bool staleBuild = false;

    /// Services the socket. Call once per frame with a small timeout so the
    /// render loop keeps its cadence even when nothing arrives.
    void poll(int timeoutMillis = 0);

    Status status() const { return status_; }
    /// Whether this client is holding an account: logged in, or in a game.
    /// Everything the server says about an account or a world is only
    /// meaningful while this holds.
    bool haveSession() const { return status_ == Status::LoggedIn || status_ == Status::Playing; }
    const std::string& lastError() const { return lastError_; }

    // -- requests ----------------------------------------------------------
    void requestRegister(const std::string& username, const std::string& password);
    void requestLogin(const std::string& username, const std::string& password);
    void resumeSession(const std::string& token);
    /// Ends the session: tells the server to log the account out -- which
    /// revokes every token it holds and signs out its other connections --
    /// then drops every scrap of the account this client was holding. The socket stays
    /// up -- the connection is not the session -- so the status falls back to
    /// Ready and the login form can be used again without a reconnect.
    void logout();
    /// `spawnChoice` is one of the server's spawn-picker ids -- a door on some
    /// map (`garden`, or a qualified `<map>:<door>`), or "pvp" / "maze" for
    /// the two realms that have no map -- and empty (or "default") for the
    /// beginner ground. It is NOT a biome name: the server resolves it through
    /// WorldMaps::choice(), and a door a map marks not pickable is only
    /// honoured for an admin session.
    /// `playerName` is the flower's nameplate; empty spawns as "Unnamed".
    void joinGame(int viewportWidth, int viewportHeight,
                  const std::string& spawnChoice = {}, const std::string& playerName = {});
    /// True from joinGame() until the server answers it: with JoinAccepted,
    /// or with the Bad notice that is its only way of saying no. Only ever
    /// true while logged in -- a dropped socket takes the join with it, and a
    /// login that follows starts with none.
    bool joinPending() const { return joinPending_ && status_ == Status::LoggedIn; }
    /// Stops waiting for a join answer that is not coming. A JoinAccepted that
    /// arrives afterwards still puts the client in the game: the server has
    /// placed the body by then, and that is the truth either way.
    void cancelJoin() { joinPending_ = false; }
    void leaveGame();
    void sendInput(const net::InputFrame&);
    void sendChat(const std::string& text);
    void setLoadoutSlot(int slot, std::uint16_t petalIndex, Rarity rarity);
    void swapLoadoutSlots(int a, int b);
    /// Every slot of the top row trades places with the one below it.
    void swapLoadoutRows();
    /// Saved loadouts, numbered as loadoutPresetName numbers them. Saving
    /// stores the whole loadout on the account; loading re-equips it, and the
    /// server answers both with a Notice.
    void saveLoadoutPreset(int preset);
    void loadLoadoutPreset(int preset);
    /// Clicks the petal in an active loadout slot.
    ///
    /// What the browser build reaches with U + the slot's number. Only the
    /// petals that DO something when they are used answer to it
    /// (petalIsClickToUse in shared/game/config.h) and the server re-checks
    /// both that and the slot's reload, so this is a request, not a command --
    /// the bar sends it and waits to see what the snapshot says.
    void usePetal(int slot);
    void requestCraft(std::uint16_t petalIndex, Rarity rarity, int count);
    /// Buys one guaranteed upgrade of this petal from the oracle the body is
    /// standing at, for oracleCraftCost(rarity) of it.
    void requestOracleCraft(std::uint16_t petalIndex, Rarity rarity);
    /// How long until the account may craft at an oracle again, counted down
    /// on this client's clock from the last profile; 0 when it may now.
    double oracleCooldownRemainingMillis() const;
    /// Hands one petal of this tier to the trader the body is standing at, for
    /// one coin of the same tier.
    void requestTrade(std::uint16_t petalIndex, Rarity rarity);
    /// How long until the account may trade again, counted down on this
    /// client's clock from the last profile; 0 when it may now.
    double traderCooldownRemainingMillis() const;
    /// Forges kTitanForgeCost apex of this petal into one universal at the
    /// titan the body is standing at.
    void requestTitanForge(std::uint16_t petalIndex);
    /// Asks the titan the body is standing at who holds this petal at
    /// universal. The answer lands in titanHolder(); the server drops a query
    /// that comes too soon after the last, so a caller asks again until one
    /// does.
    void requestTitanHolder(std::uint16_t petalIndex);
    /// The last answer for this petal -- a username, or empty for nobody --
    /// or null when none has come back since it was last forgotten.
    const std::string* titanHolder(std::uint16_t petalIndex) const;
    /// Forgets the answer for this petal, so the next look asks again.
    void forgetTitanHolder(std::uint16_t petalIndex) { titanHolders_.erase(petalIndex); }
    void requestRespawn();
    void sendPing();
    /// Buys the NEXT tier of a branch. The server refuses anything else, so
    /// the panel never has to guess whether a jump would be allowed.
    void requestUpgradeSkill(SkillId skill, int tier);
    void requestResetSkills();
    /// Buys a petal. `offerSlot` is which card of the rotating store was
    /// clicked; the default buys at the full ladder price. Either way the
    /// price is the server's to decide -- the slot says which card, not what
    /// it costs.
    void requestBuyPetal(std::uint16_t petalIndex, Rarity rarity, int offerSlot = -1);
    /// Redeems a star code. The answer lands in shopOutcome().
    void requestRedeemCode(const std::string& code);
    /// Changes this session's account password. The answer lands in
    /// passwordOutcome(); on success the server also hands back a replacement
    /// session token, because the change revokes the one this client holds.
    /// Which account it is is the session's to say, so no name goes with it.
    void requestChangePassword(const std::string& current, const std::string& next);
    void requestSkin(std::uint32_t renderFlags);
    /// Offers an authored skin to the shared catalog. The server re-sanitizes
    /// and assigns the id, so nothing here is authoritative -- the studio runs
    /// the same check first only so a rejection is instant.
    void publishSkin(const std::string& name, const std::vector<SkinShape>& shapes);
    /// Wears a published skin, or takes the current one off when `id` is empty.
    /// The local field moves immediately: the reference equips optimistically
    /// and the server's answer is the persistence, not the confirmation.
    void equipSkin(const std::string& id);
    void deleteSkin(const std::string& id);
    /// `includeAdmins` is the "Show Admins on Leaderboard" switch: without it
    /// the server leaves admin accounts off the board.
    void requestLeaderboard(bool includeAdmins = false);
    /// Asks for one page of the global notification feed, newest first.
    /// `beforeMillis` of 0 asks for the newest page; anything else pages back
    /// past the oldest entry already held, as the browser's `?before=` does.
    void requestNotifications(int limit, double beforeMillis);

    void requestGuildCreate(const std::string& tag, const std::string& displayName = {});
    void requestGuildEdit(const std::string& displayName, const std::string& description);
    void requestGuildInvite(const std::string& username);
    void requestGuildAccept();
    void requestGuildDecline();
    void requestGuildKick(const std::string& username);
    void requestGuildLeave();
    void requestGuildSquadAll();
    void requestGuildInviteToSquad(const std::string& username);

    // -- the admin database editor -------------------------------------------
    //
    // Requests, all of them: the server re-checks the account's admin flag on
    // every one and answers into adminDb(). Nothing here is applied locally
    // first -- what the panel shows is what the server says it stored.

    /// One page of accounts whose names contain `search`. Offset 0 starts a
    /// new list; any other offset asks for the page after the rows held.
    void adminDbList(const std::string& search, std::uint32_t offset);
    void adminDbTables();
    /// Makes this the open document and asks for it. Whatever was open is
    /// dropped at once, so a slow answer cannot paint the old one under the
    /// new name.
    void adminDbOpen(net::AdminDbScope, const std::string& key);
    void adminDbClose();
    /// One node of the open document: what opening an unloaded row asks for.
    void adminDbFetch(const net::AdminDbPath&);
    /// `json` is the new value as JSON text, which the server parses.
    void adminDbSet(const net::AdminDbPath&, const std::string& json);
    void adminDbRemove(const net::AdminDbPath&);
    void adminDbSetPassword(const std::string& username, const std::string& password);
    void adminDbSignOut(const std::string& username);
    void adminDbDeleteAccount(const std::string& username);
    AdminDbState& adminDb() { return adminDb_; }
    const AdminDbState& adminDb() const { return adminDb_; }

    // -- state -------------------------------------------------------------
    WorldView& view() { return view_; }
    const WorldView& view() const { return view_; }
    /// The map grid the server sent, plus the collision SHAPES this client
    /// read out of its own copy of the map. See setWorldMaps().
    const Terrain& terrain() const { return terrain_; }

    /// Every map staged beside this client, which is where the COLLISION
    /// SHAPES of the realm it is playing in come from.
    ///
    /// The grid over the wire is one value per cell -- ground, wall, water --
    /// and that is all it can be: the shapes a cell actually blocks with are
    /// polygons, thousands of them, and they are already in the map file both
    /// ends ship. So the wire stays the authoritative COARSE view and the
    /// dimensions, and the exact geometry is rebuilt locally from the file,
    /// which the handshake's content hash has already proved identical to the
    /// server's -- the map AND the tileset it names, which is where the shapes
    /// are (ContentRegistry::foldMapsIntoHash).
    ///
    /// Optional: a client that sets none (and one whose data directory has no
    /// map for the realm it is dropped into) collides against whole cells
    /// instead -- see installLocalCollision(). The pointer is borrowed and
    /// must outlive the connection; App owns the one this client uses.
    void setWorldMaps(const WorldMaps* maps) { worldMaps_ = maps; }

    /// True once after the body was moved to another realm -- through a
    /// teleporter, which leads to another map. Consumed by the App, which
    /// snaps the camera onto `realmArrival()`: easing across two coordinate
    /// spaces sweeps the view over a world the flower is not in.
    bool takeRealmChange(Vec2& arrivalOut) {
        if (!realmChanged_) return false;
        realmChanged_ = false;
        arrivalOut = realmArrival_;
        return true;
    }
    /// Where the server last put this flower's body -- the join's spawn, or a
    /// realm change's arrival -- for the frames between that message and the
    /// first snapshot of the new body. The view's own self position is zero
    /// until a snapshot places it, and a camera pinned to zero draws the
    /// map's corner. See selfPlaced().
    Vec2 arrival() const { return realmArrival_; }
    /// True once a snapshot has placed the body the view is drawing; until
    /// then arrival() is the only honest position for it.
    bool selfPlaced() const { return view_.self().netId != 0; }
    const Profile& profile() const { return profile_; }
    const std::string& sessionToken() const { return sessionToken_; }
    const std::vector<ChatLine>& chat() const { return chat_; }
    /// How many lines this transcript has ever taken, trimmed ones included.
    /// chat().size() stops answering that at the cap, and a reader scrolled
    /// back through the box needs to know a line ARRIVED, not that the vector
    /// grew.
    std::uint64_t chatSequence() const { return chatSeq_; }
    /// Who the latest whisper was from or to, which is who the chat box's
    /// Whisper channel answers. Empty until one has passed either way.
    const std::string& whisperPartner() const { return whisperPartner_; }
    /// The same lines, as the world-anchored bubbles over the flowers that
    /// said them. Aged by ageChatBubbles(), drawn by the world renderer.
    const ChatBubbles& chatBubbles() const { return chatBubbles_; }
    void ageChatBubbles(double dtSeconds) { chatBubbles_.update(dtSeconds); }
    const DailyStreak& dailyStreak() const { return dailyStreak_; }

    /// Every published skin the server has told this client about, the one this
    /// account is wearing, and whether it may take other people's skins down.
    ///
    /// One registry for two readers: the studio's Browse tab lists it, and the
    /// world renderer resolves a wearer's id through it. A skin nobody has been
    /// sent cannot be drawn, which is why the catalog arrives at login rather
    /// than when the studio opens.
    const std::vector<CustomSkin>& skinCatalog() const { return skinCatalog_; }
    const CustomSkin* findSkin(const std::string& id) const;
    const std::string& equippedSkinId() const { return equippedSkinId_; }
    bool isSkinAdmin() const { return skinAdmin_; }

    /// Puts a locally generated System line in the transcript. There is no
    /// separate notice or toast layer: every announcement the reference makes,
    /// its own included, is a chat line.
    void addSystemMessage(const std::string& text);
    /// The same, under a chosen sender. The studio reports its own failures as
    /// lines from "Skins", exactly as the reference does, so the author is not
    /// always "System". A screenshot run seeds other channels through it.
    void addLocalChat(const std::string& author, const std::string& text,
                      net::ChatChannel channel = net::ChatChannel::System);

    /// Round-trip time in milliseconds, from the last Ping/Pong exchange.
    double pingMillis() const { return pingMillis_; }
    /// The mean of the last ten round trips, which is what the readout shows:
    /// a single sample jitters too much to read, and the quality band below is
    /// derived from the same average so the two never disagree.
    double averagePingMillis() const { return averagePingMillis_; }
    /// "good", "medium" or "slow", at the reference's 100 ms / 200 ms bands.
    const char* connectionQuality() const;

    /// One opcode's share of the wire over the last window.
    struct WireEvent {
        const char* name = "";
        std::uint32_t bytes = 0;
        bool incoming = false;
    };
    /// Totals the bytes seen since the last call, fills `top` with the
    /// heaviest events first, and resets the counters -- so the caller is
    /// asking for bytes per window, and should ask once a second.
    ///
    /// Bytes are real framed sizes, not an estimate: both the send path and
    /// the dispatch have the encoded buffer in hand when they count it.
    void takeWireStats(std::uint32_t& inBytes, std::uint32_t& outBytes,
                       std::vector<WireEvent>& top, std::size_t topCount = 5);

    /// The server's own memory and tick cost, from the last DebugStats. Null
    /// until one arrives, which is what the debug panel draws as "no data".
    struct ServerDebugStats {
        double residentBytes = 0;
        double heapBytes = 0;
        double tickAvgMillis = 0;
        double tickMaxMillis = 0;
    };
    const ServerDebugStats* serverDebugStats() const {
        return haveServerDebugStats_ ? &serverDebugStats_ : nullptr;
    }
    /// True exactly once per DebugStats, so the panel appends one graph sample
    /// per packet rather than resampling whatever it last saw.
    bool takeServerDebugStats(ServerDebugStats& out);

    const std::vector<LeaderboardRow>& leaderboard() const { return leaderboard_; }
    /// True between asking for the board and the answer arriving.
    bool leaderboardPending() const { return leaderboardPending_; }
    /// How many accounts the server holds, and how many of them authenticated
    /// in the last day. The second is 0 for a non-admin, which is how the
    /// browser's payload leaves the field out.
    std::uint32_t totalAccounts() const { return totalAccounts_; }
    std::uint32_t dailyActiveUsers() const { return dailyActiveUsers_; }

    const std::vector<NotificationEntry>& notifications() const { return notifications_; }
    /// True between asking for a page and the answer arriving.
    bool notificationsPending() const { return notificationsPending_; }
    /// True while there may be an older page to ask for. Starts true and is
    /// only ever answered by a reply, exactly as the reference's `hasMore` is:
    /// a panel opening for the first time draws its loading footer on the
    /// strength of it.
    bool notificationsHaveMore() const { return notificationsMore_; }
    /// Bumped whenever the feed is replaced or grown. What it is for is the
    /// unread badge on the notifications button: recounting the feed against
    /// the read marks every frame is work with an answer that only changes
    /// when a page lands, and this is how a reader knows one did.
    std::uint32_t notificationsRevision() const { return notificationsRevision_; }

    const SquadState& squad() const { return squad_; }

    const GuildState& guild() const { return guild_; }
    /// Mutable because the panel answers an invite locally the moment it sends
    /// the reply, exactly as the reference clears `pendingInvite` on click.
    GuildInvite& guildInvite() { return guildInvite_; }
    const GuildInvite& guildInvite() const { return guildInvite_; }

    /// The last craft result. The panel clears `pending` once it has started
    /// the animation for it.
    CraftOutcome& craftOutcome() { return craftOutcome_; }
    /// The last oracle result, read and cleared the same way.
    OracleOutcome& oracleOutcome() { return oracleOutcome_; }
    /// The last trade result, read and cleared the same way.
    TradeOutcome& tradeOutcome() { return tradeOutcome_; }
    /// The last titan forge result, read and cleared the same way.
    TitanForgeOutcome& titanForgeOutcome() { return titanForgeOutcome_; }

    /// The last purchase or code redemption. The shop panel clears `pending`
    /// once it has raised the modal for it.
    ShopOutcome& shopOutcome() { return shopOutcome_; }

    /// The last change-password answer. The settings panel clears `pending`
    /// once it has put the line under its form.
    PasswordOutcome& passwordOutcome() { return passwordOutcome_; }

    /// Set once each time the server issued a REPLACEMENT session token for a
    /// session this client is already in -- which a password change does, and
    /// nothing else does yet. Read and cleared by the app, whose business the
    /// stored token is; a client that missed it would keep writing the revoked
    /// token to disk and be asked to log in again on its next start.
    bool sessionTokenRenewed = false;

    /// Set once each time the server signed this client out because the
    /// account was logged out from another connection. NetClient has already
    /// forgotten the account by then; the app still has to leave the screen it
    /// is on and empty the token file, which are its business, not this one's.
    bool signedOutElsewhere = false;

    /// Set once each time the server signed this client out because the same
    /// account signed in on another connection -- another tab, another device.
    /// The socket is already down and deliberately NOT being redialled; the
    /// account's token is kept, because it is still good and redial() is how
    /// the player takes the account back. The reason is in lastError().
    bool sessionReplaced = false;

    /// Set when the server reports the player died; cleared by respawning, or
    /// by a yggdrasil raising this body back up.
    bool dead() const { return dead_; }
    const std::string& killerName() const { return killerName_; }

    /// Set once each time a yggdrasil raised this body. Cleared by whoever
    /// reads it, like `reconnected`: the socket knows the player is alive
    /// again, but only the app can take the death screen down -- and it must
    /// not confuse this with `--dead`, which puts that screen up with no death
    /// behind it at all.
    bool revived = false;

    /// Set when an auth attempt finished. The UI reads and clears it.
    bool authAnswered = false;
    net::AuthStatus authStatus = net::AuthStatus::Ok;
    std::string authMessage;

    /// The content hash this client loaded, sent in the handshake so a server
    /// with different mob/petal data can say so instead of quietly disagreeing.
    std::uint32_t contentHash = 0;

    // net::TransportHandler
    void onConnect(net::Connection&) override;
    void onMessage(net::Connection&, ByteReader&) override;
    void onDisconnect(net::Connection&, const std::string& reason) override;

private:
    void send(ByteWriter&);
    void beginMessage(ByteWriter&, net::ClientMessage);
    /// The client half of a logout: drops every scrap of the account without
    /// telling the server anything. logout() sends first; a sign-out the
    /// server announced has nothing to send.
    void forgetAccount();

    void handleWelcome(ByteReader&);
    void handleAuthResult(ByteReader&);
    void handleProfile(ByteReader&);
    void handleJoinAccepted(ByteReader&);
    void handleRealmChange(ByteReader&);
    void handleMazeInfo(ByteReader&);
    void handleChat(ByteReader&);
    /// The conversation already in progress when this account signed in, put
    /// ABOVE whatever the transcript holds: it is older than all of it.
    void handleChatHistory(ByteReader&);
    void handleNotice(ByteReader&);
    /// Appends one line and trims the transcript to its cap. A non-zero
    /// `speakerNetId` also raises a bubble over that flower.
    void pushChat(net::ChatChannel, std::string author, std::string text,
                  std::uint32_t speakerNetId = 0);
    void handleDied(ByteReader&);
    void handleRevived(ByteReader&);
    void handleCraftResult(ByteReader&);
    void handleOracleResult(ByteReader&);
    void handleTradeResult(ByteReader&);
    void handleTitanForgeResult(ByteReader&);
    void handleTitanHolder(ByteReader&);
    void handleShopResult(ByteReader&);
    void handleChangePasswordResult(ByteReader&);
    void handleLeaderboard(ByteReader&);
    void handleNotifications(ByteReader&);
    /// Schedules the next redial, lengthening the wait each time it is
    /// called without a handshake in between.
    void armReconnect();

    void handleSquadUpdate(ByteReader&);
    void handleGuildUpdate(ByteReader&);
    void handleGuildInviteReceived(ByteReader&);
    void handlePong(ByteReader&);
    void handleDebugStats(ByteReader&);
    void handleKick(ByteReader&);
    void handleSessionReplaced(ByteReader&);
    void handleDailyStreak(ByteReader&);
    void handleSkinCatalog(ByteReader&);
    void handleSkinPublished(ByteReader&);
    void handleSkinDeleted(ByteReader&);
    void handleAdminDb(ByteReader&);
    /// Starts an AdminDb request with its op and, for the document ops, the
    /// open document's scope and key.
    void beginAdminDb(ByteWriter&, net::AdminDbOp);

    /// Rebuilds one realm's collision shapes from this client's own copy of
    /// its map, right after the wire's grid for that realm was installed.
    /// Called on the join and on every realm change, which are the only two
    /// messages that carry a map.
    void installLocalCollision(Realm realm);

    net::Dialer dialer_;
    Status status_ = Status::Offline;

    /// Where connect() was last pointed, so a drop can be redialled without
    /// the caller having to remember for it.
    std::string host_;
    std::uint16_t port_ = 0;
    /// The render clock at which the next redial is due, or 0 for none, and
    /// the delay that produced it.
    double retryAtMillis_ = 0;
    double retryDelayMillis_ = 0;
    /// How many handshakes this client has completed. The first is the
    /// ordinary connect; every one after it is a reconnection.
    int handshakes_ = 0;
    std::string lastError_;

    WorldView view_;
    Terrain terrain_;
    /// Borrowed; see setWorldMaps(). Null is a client that collides against
    /// whole cells.
    const WorldMaps* worldMaps_ = nullptr;
    Vec2 realmArrival_;
    bool realmChanged_ = false;
    Profile profile_;
    std::string sessionToken_;
    std::vector<ChatLine> chat_;
    std::uint64_t chatSeq_ = 0;
    /// Set once this account's backlog is in the transcript. Every
    /// authentication sends it, reconnects included, and a client that stayed
    /// up through the drop already holds every line of it; only forgetting the
    /// account -- which empties the transcript -- makes room for another.
    bool chatBackfilled_ = false;
    std::string whisperPartner_;
    ChatBubbles chatBubbles_;
    DailyStreak dailyStreak_;

    std::vector<CustomSkin> skinCatalog_;
    std::string equippedSkinId_;
    bool skinAdmin_ = false;

    std::vector<LeaderboardRow> leaderboard_;
    bool leaderboardPending_ = false;
    std::uint32_t totalAccounts_ = 0;
    std::uint32_t dailyActiveUsers_ = 0;

    std::vector<NotificationEntry> notifications_;
    bool notificationsPending_ = false;
    bool notificationsMore_ = true;
    /// Whether the request in flight asked for an OLDER page. A page from the
    /// newest end replaces the feed; one from behind the oldest entry appends
    /// to it, and only the request knows which this is.
    bool notificationsPaging_ = false;
    std::uint32_t notificationsRevision_ = 0;

    SquadState squad_;
    GuildState guild_;
    GuildInvite guildInvite_;
    CraftOutcome craftOutcome_;
    OracleOutcome oracleOutcome_;
    /// When, on this client's steady clock, the oracle wait the last profile
    /// reported runs out.
    double oracleReadyAtMillis_ = 0;
    TradeOutcome tradeOutcome_;
    /// The same for the trader's wait.
    double traderReadyAtMillis_ = 0;
    TitanForgeOutcome titanForgeOutcome_;
    /// The titan's answers, by petal: who holds it at universal.
    std::unordered_map<std::uint16_t, std::string> titanHolders_;
    ShopOutcome shopOutcome_;
    PasswordOutcome passwordOutcome_;
    AdminDbState adminDb_;

    double pingMillis_ = 0;
    /// The last ten round trips and their mean. Ten is the reference's window.
    static constexpr std::size_t kPingSamples = 10;
    std::vector<double> pingHistory_;
    double averagePingMillis_ = 0;

    /// Wire bytes since the last takeWireStats(), indexed by opcode. Two flat
    /// arrays rather than a map keyed by name: the counting happens on every
    /// frame of every message, and the names are only needed once a second
    /// when the overlay asks.
    std::array<std::uint32_t, 256> incomingBytes_{};
    std::array<std::uint32_t, 256> outgoingBytes_{};

    ServerDebugStats serverDebugStats_;
    bool haveServerDebugStats_ = false;
    bool serverDebugStatsFresh_ = false;

    bool dead_ = false;
    std::string killerName_;
    /// See joinPending().
    bool joinPending_ = false;

    /// Chat is capped so a long session cannot grow without bound; the oldest
    /// lines scroll off, which is what the panel shows anyway.
    static constexpr std::size_t kMaxChatLines = 100;
};

} // namespace flix
