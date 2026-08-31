#pragma once
// The client's connection to a server.
//
// Owns the socket, the handshake, and the mapping from server messages to
// client state. Everything it learns lands in a WorldView or in one of the
// fields below; nothing in the renderer talks to a socket.

#include <cstdint>
#include <deque>
#include <string>
#include <vector>

#include "client/world_view.h"
#include "shared/game/terrain.h"
#include "shared/net/protocol.h"
#include "shared/net/transport.h"

namespace flr {

/// The account state the server sends after login, and keeps up to date.
struct Profile {
    std::string username;
    double totalXp = 0;
    int level = 1;
    int stars = 0;

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
};

struct ChatLine {
    net::ChatChannel channel = net::ChatChannel::Global;
    std::string author;
    std::string text;
    double receivedAtMillis = 0;
};

struct Notice {
    net::NoticeSeverity severity = net::NoticeSeverity::Info;
    std::string text;
    double receivedAtMillis = 0;
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

    /// Services the socket. Call once per frame with a small timeout so the
    /// render loop keeps its cadence even when nothing arrives.
    void poll(int timeoutMillis = 0);

    Status status() const { return status_; }
    const std::string& lastError() const { return lastError_; }

    // -- requests ----------------------------------------------------------
    void requestRegister(const std::string& username, const std::string& password);
    void requestLogin(const std::string& username, const std::string& password);
    void resumeSession(const std::string& token);
    void joinGame(int viewportWidth, int viewportHeight);
    void leaveGame();
    void sendInput(const net::InputFrame&);
    void sendChat(const std::string& text);
    void setLoadoutSlot(int slot, std::uint16_t petalIndex, Rarity rarity);
    void swapLoadoutSlots(int a, int b);
    void requestCraft(std::uint16_t petalIndex, Rarity rarity, int count);
    void requestRespawn();
    void sendPing();

    // -- state -------------------------------------------------------------
    WorldView& view() { return view_; }
    const WorldView& view() const { return view_; }
    /// Locally regenerated from the authoritative seed in JoinAccepted.
    const Terrain& terrain() const { return terrain_; }
    const Profile& profile() const { return profile_; }
    const std::string& sessionToken() const { return sessionToken_; }
    const std::vector<ChatLine>& chat() const { return chat_; }
    std::vector<Notice>& notices() { return notices_; }

    /// Round-trip time in milliseconds, from the last Ping/Pong exchange.
    double pingMillis() const { return pingMillis_; }

    /// Set when the server reports the player died; cleared by respawning.
    bool dead() const { return dead_; }
    const std::string& killerName() const { return killerName_; }

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

    void handleWelcome(ByteReader&);
    void handleAuthResult(ByteReader&);
    void handleProfile(ByteReader&);
    void handleJoinAccepted(ByteReader&);
    void handleChat(ByteReader&);
    void handleNotice(ByteReader&);
    void handleDied(ByteReader&);
    void handlePong(ByteReader&);
    void handleKick(ByteReader&);

    net::Dialer dialer_;
    Status status_ = Status::Offline;
    std::string lastError_;

    WorldView view_;
    Terrain terrain_;
    Profile profile_;
    std::string sessionToken_;
    std::vector<ChatLine> chat_;
    std::vector<Notice> notices_;

    double pingMillis_ = 0;
    bool dead_ = false;
    std::string killerName_;

    /// Chat is capped so a long session cannot grow without bound; the oldest
    /// lines scroll off, which is what the panel shows anyway.
    static constexpr std::size_t kMaxChatLines = 100;
};

} // namespace flr
