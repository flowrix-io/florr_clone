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

    void sendAuthResult(net::Connection&, net::AuthStatus, const std::string& token,
                        const std::string& username, const std::string& reason);
    void sendProfile(Session&, net::Connection&);
    void sendNotice(net::Connection&, net::NoticeSeverity, const std::string& text);
    void broadcastChat(net::ChatChannel, const std::string& author, const std::string& text);

    // -- lifecycle ---------------------------------------------------------
    Entity spawnPlayer(Session&);
    void despawnPlayer(Session&, bool persist);
    /// Copies the live entity's progress back onto the account record. Called
    /// on leave, on death, and periodically -- a crash must not cost a session
    /// of progress.
    void persistPlayer(const Session&);
    void applyAccountToEntity(const PlayerRecord&, Entity);

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
    SpatialGrid grid_;
    Rng rng_;

    Database database_;
    net::Listener listener_;

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
