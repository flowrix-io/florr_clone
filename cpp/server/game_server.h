#pragma once
// The authoritative game server: one world, one fixed-rate tick, N clients.
//
// Everything the simulation needs is owned here and passed down. Systems hold
// no global state and no references to each other -- they are given the world
// and whatever read-only services they need, and they communicate through
// components and the command buffer. That is what makes them testable in
// isolation and what keeps the tick order legible in one function.

#include <atomic>
#include <cstdint>
#include <memory>
#include <string>
#include <unordered_map>
#include <vector>

#include "server/db.h"
#include "server/replication.h"
#include "server/session.h"
#include "shared/core/world.h"
#include "shared/game/components.h"
#include "shared/game/map_elements.h"
#include "shared/game/spatial.h"
#include "shared/game/terrain.h"
#include "shared/net/transport.h"

namespace flr {

class MovementSystem;
class MobAiSystem;
class PetalSystem;
class CombatSystem;
class SpawnSystem;
class LootSystem;

struct ServerConfig {
    std::uint16_t port = 4242;
    std::string dataDir = "data";
    std::string databasePath = "inventory.json";
    std::uint64_t worldSeed = 0x5EED10;
    /// Refuses connections past this; the tick cost is linear in players and
    /// the snapshot cost is worse, so this is a real limit, not a formality.
    std::size_t maxPlayers = 64;
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

    /// Safe to call from a signal handler: it only stores to an atomic flag,
    /// and the shutdown work itself happens on the main thread.
    void stop() { running_.store(false); }

    /// One fixed simulation step. Deliberately does NOT touch the network, so
    /// a test can drive the simulation deterministically without a clock.
    void tick(double nowMillis);

    /// Accepts connections and dispatches whatever has arrived, for up to
    /// `timeoutMillis`. run() interleaves this with tick(); a test drives the
    /// two itself.
    void serviceNetwork(int timeoutMillis);

    World& world() { return world_; }
    const Terrain& terrain() const { return *terrain_; }
    const MapData& mapData() const { return mapData_; }
    std::size_t playerCount() const;

    // net::TransportHandler
    void onConnect(net::Connection& c) override;
    void onMessage(net::Connection& c, ByteReader& reader) override;
    void onDisconnect(net::Connection& c, const std::string& reason) override;

private:
    // -- message handling --------------------------------------------------
    void handleHello(Session&, net::Connection&, ByteReader&);
    void handleRegister(Session&, net::Connection&, ByteReader&);
    void handleLogin(Session&, net::Connection&, ByteReader&);
    void handleResume(Session&, net::Connection&, ByteReader&);
    void handleJoin(Session&, net::Connection&, ByteReader&);
    void handleLeave(Session&, net::Connection&);
    void handleInput(Session&, ByteReader&);
    void handleChat(Session&, net::Connection&, ByteReader&);
    void handleSetLoadout(Session&, ByteReader&);
    void handleSwapLoadout(Session&, ByteReader&);
    void handleCraft(Session&, net::Connection&, ByteReader&);
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
    void handleLeaderboard(const Session&, net::Connection&);
    void handleNotifications(net::Connection&, ByteReader&);

    // -- guilds ------------------------------------------------------------
    //
    // Storage is the database's own `guilds` table, in the browser build's
    // shape: an object keyed by the upper-cased five-character name, each
    // value carrying {name, leaderUsername, memberUsernames, createdAt}. Held
    // as JSON rather than mirrored into a typed cache because the same file is
    // read by the browser build, and a second copy is a second thing to keep
    // true.
    void handleGuildCreate(Session&, net::Connection&, ByteReader&);
    void handleGuildInvite(Session&, net::Connection&, ByteReader&);
    void handleGuildAccept(Session&, net::Connection&);
    void handleGuildDecline(Session&, net::Connection&);
    void handleGuildKick(Session&, net::Connection&, ByteReader&);
    void handleGuildLeave(Session&, net::Connection&);
    void handleGuildSquadAll(Session&, net::Connection&);
    void handleGuildInviteToSquad(Session&, net::Connection&, ByteReader&);

    void sendAuthResult(net::Connection&, net::AuthStatus, const std::string& token,
                        const std::string& username, const std::string& reason);
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
    void sendShopResult(net::Connection&, net::ShopResultKind, bool ok, int stars,
                        const std::string& message);
    void broadcastChat(net::ChatChannel, const std::string& author, const std::string& text);
    /// One chat line to one connection, under a chosen author. The guild's own
    /// announcements are signed "[Guild NAME]" rather than "System", which a
    /// Notice -- whose author is always System -- cannot express.
    void sendChatTo(net::Connection&, net::ChatChannel, const std::string& author,
                    const std::string& text);

    /// The guild `username` belongs to, or an empty string. Searched rather
    /// than indexed: membership lives on the guild, not on the account, and a
    /// derived index would be a second thing to keep true.
    std::string guildNameForUser(const std::string& username) const;
    Session* sessionForUser(const std::string& username);
    net::Connection* connectionForUser(const std::string& username);
    /// One roster message: the guild as it stands, each member flagged online.
    void sendGuildRoster(net::Connection&, const Json& guild);
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

    // -- lifecycle ---------------------------------------------------------
    Entity spawnPlayer(Session&);
    void despawnPlayer(Session&, bool persist);
    /// Copies the live entity's progress back onto the account record. Called
    /// on leave, on death, and periodically -- a crash must not cost a session
    /// of progress.
    void persistPlayer(const Session&);
    void applyAccountToEntity(const PlayerRecord&, Entity);
    /// Credits the mob kills from this tick to whoever landed the last blow:
    /// the gallery ledger, and the stars a mythic-or-better kill is worth.
    void bankKills();

    Session* sessionFor(net::ConnectionId id);
    Session* sessionForEntity(Entity e);

    // -- tick phases -------------------------------------------------------
    void runSystems(double nowMillis, double dt);
    /// Moves what the loot system handed out into the owning accounts.
    void bankPickups();
    void replicate(double nowMillis);
    void reapDead(double nowMillis);

    ServerConfig config_;
    std::atomic<bool> running_{false};

    World world_;
    CommandBuffer commands_{world_};
    std::unique_ptr<Terrain> terrain_;
    /// The map's annotation layer: which ground is the beginner's, and which
    /// rectangle is which biome. Read only when a player spawns.
    MapData mapData_;
    SpatialGrid grid_;
    Rng rng_;

    Database database_;
    net::Listener listener_;

    /// Guild invitations waiting on an answer, keyed by the lower-cased
    /// invitee. In memory only and one deep per player, exactly as the
    /// reference's `pendingGuildInvites` is: an invitation is a conversation,
    /// not a record.
    struct PendingGuildInvite {
        std::string guildName;
        std::string fromUsername;
        std::int64_t expiresAtMillis = 0;
    };
    std::unordered_map<std::string, PendingGuildInvite> guildInvites_;

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
    std::unique_ptr<LootSystem> loot_;

    /// Positions of every live player, rebuilt each tick. Spawning and the mob
    /// LOD both need it, and recomputing it per system would walk the player
    /// query several times for no reason.
    std::vector<Vec2> activePlayers_;

    std::uint32_t tick_ = 0;
    double nextPersistMillis_ = 0;
    ByteWriter scratch_;
};

} // namespace flr
