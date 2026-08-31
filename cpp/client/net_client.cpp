#include "client/net_client.h"

#include <chrono>

namespace flr {

namespace {

double nowMillis() {
    using clock = std::chrono::steady_clock;
    static const clock::time_point start = clock::now();
    return std::chrono::duration<double, std::milli>(clock::now() - start).count();
}

} // namespace

NetClient::NetClient() = default;
NetClient::~NetClient() = default;

bool NetClient::connect(const std::string& host, std::uint16_t port) {
    disconnect();
    std::string error;
    if (!dialer_.connect(host, port, error)) {
        status_ = Status::Failed;
        lastError_ = error;
        return false;
    }
    status_ = Status::Connecting;
    lastError_.clear();
    return true;
}

void NetClient::disconnect() {
    dialer_.disconnect();
    status_ = Status::Offline;
    view_.clear();
    dead_ = false;
}

void NetClient::poll(int timeoutMillis) {
    if (status_ == Status::Offline || status_ == Status::Failed) return;
    dialer_.poll(*this, timeoutMillis);
    dialer_.flush();
    if (dialer_.state() == net::Dialer::State::Failed && status_ != Status::Failed) {
        status_ = Status::Failed;
        if (lastError_.empty()) lastError_ = dialer_.error();
    }
}

void NetClient::beginMessage(ByteWriter& w, net::ClientMessage id) {
    w.clear();
    w.u8(static_cast<std::uint8_t>(id));
}

void NetClient::send(ByteWriter& w) {
    dialer_.send(w);
}

// -- outgoing ---------------------------------------------------------------

void NetClient::onConnect(net::Connection&) {
    status_ = Status::Handshaking;
    // The handshake goes out unprompted: the server answers with Welcome, and
    // until then nothing else this client sends will be accepted.
    ByteWriter w;
    beginMessage(w, net::ClientMessage::Hello);
    w.u16(net::kProtocolVersion);
    w.u32(contentHash);
    send(w);
}

void NetClient::requestRegister(const std::string& username, const std::string& password) {
    ByteWriter w;
    beginMessage(w, net::ClientMessage::Register);
    w.str(username);
    w.str(password);
    send(w);
}

void NetClient::requestLogin(const std::string& username, const std::string& password) {
    ByteWriter w;
    beginMessage(w, net::ClientMessage::Login);
    w.str(username);
    w.str(password);
    send(w);
}

void NetClient::resumeSession(const std::string& token) {
    ByteWriter w;
    beginMessage(w, net::ClientMessage::ResumeSession);
    w.str(token);
    send(w);
}

void NetClient::joinGame(int viewportWidth, int viewportHeight) {
    ByteWriter w;
    beginMessage(w, net::ClientMessage::JoinGame);
    w.u16(static_cast<std::uint16_t>(viewportWidth));
    w.u16(static_cast<std::uint16_t>(viewportHeight));
    send(w);
}

void NetClient::leaveGame() {
    ByteWriter w;
    beginMessage(w, net::ClientMessage::LeaveGame);
    send(w);
    if (status_ == Status::Playing) status_ = Status::LoggedIn;
    view_.clear();
    dead_ = false;
}

void NetClient::sendInput(const net::InputFrame& input) {
    if (status_ != Status::Playing) return;
    ByteWriter w;
    beginMessage(w, net::ClientMessage::Input);
    input.write(w);
    send(w);
}

void NetClient::sendChat(const std::string& text) {
    if (text.empty()) return;
    ByteWriter w;
    beginMessage(w, net::ClientMessage::Chat);
    w.str(text);
    send(w);
}

void NetClient::setLoadoutSlot(int slot, std::uint16_t petalIndex, Rarity rarity) {
    ByteWriter w;
    beginMessage(w, net::ClientMessage::SetLoadout);
    w.u8(static_cast<std::uint8_t>(slot));
    w.u16(petalIndex);
    w.u8(static_cast<std::uint8_t>(rarity));
    send(w);
}

void NetClient::swapLoadoutSlots(int a, int b) {
    ByteWriter w;
    beginMessage(w, net::ClientMessage::SwapLoadout);
    w.u8(static_cast<std::uint8_t>(a));
    w.u8(static_cast<std::uint8_t>(b));
    send(w);
}

void NetClient::requestCraft(std::uint16_t petalIndex, Rarity rarity, int count) {
    ByteWriter w;
    beginMessage(w, net::ClientMessage::Craft);
    w.u16(petalIndex);
    w.u8(static_cast<std::uint8_t>(rarity));
    w.u8(static_cast<std::uint8_t>(count));
    send(w);
}

void NetClient::requestRespawn() {
    ByteWriter w;
    beginMessage(w, net::ClientMessage::Respawn);
    send(w);
}

void NetClient::sendPing() {
    ByteWriter w;
    beginMessage(w, net::ClientMessage::Ping);
    w.u64(static_cast<std::uint64_t>(nowMillis()));
    send(w);
}

// -- incoming ---------------------------------------------------------------

void NetClient::onMessage(net::Connection&, ByteReader& reader) {
    const auto id = static_cast<net::ServerMessage>(reader.u8());
    switch (id) {
        case net::ServerMessage::Welcome:      handleWelcome(reader); break;
        case net::ServerMessage::AuthResult:   handleAuthResult(reader); break;
        case net::ServerMessage::Profile:      handleProfile(reader); break;
        case net::ServerMessage::JoinAccepted: handleJoinAccepted(reader); break;
        case net::ServerMessage::Snapshot:     view_.applySnapshot(reader); break;
        case net::ServerMessage::Chat:         handleChat(reader); break;
        case net::ServerMessage::Notice:       handleNotice(reader); break;
        case net::ServerMessage::Died:         handleDied(reader); break;
        case net::ServerMessage::Pong:         handlePong(reader); break;
        case net::ServerMessage::Kick:         handleKick(reader); break;
        default:
            // An unknown id means the server is newer than this build. The
            // frame is already fully buffered, so skipping it is safe and
            // keeps older clients working against additive changes.
            break;
    }
}

void NetClient::onDisconnect(net::Connection&, const std::string& reason) {
    status_ = Status::Failed;
    lastError_ = reason;
    view_.clear();
}

void NetClient::handleWelcome(ByteReader& reader) {
    const std::uint16_t version = reader.u16();
    const bool accepted = reader.boolean();
    const std::string reason = reader.str();
    if (!reader.ok()) return;

    if (!accepted) {
        status_ = Status::Failed;
        lastError_ = reason.empty()
            ? ("Server speaks protocol " + std::to_string(version) + ", this client speaks " +
               std::to_string(net::kProtocolVersion))
            : reason;
        dialer_.disconnect();
        return;
    }
    status_ = Status::Ready;
}

void NetClient::handleAuthResult(ByteReader& reader) {
    const auto result = static_cast<net::AuthStatus>(reader.u8());
    const std::string token = reader.str();
    const std::string username = reader.str();
    const std::string reason = reader.str();
    if (!reader.ok()) return;

    authAnswered = true;
    authStatus = result;
    authMessage = reason;

    if (result == net::AuthStatus::Ok) {
        sessionToken_ = token;
        profile_.username = username;
        status_ = Status::LoggedIn;
    } else if (result == net::AuthStatus::SessionExpired) {
        // The stored token is no longer usable; drop it so the UI falls back
        // to the login form instead of retrying it forever.
        sessionToken_.clear();
        status_ = Status::Ready;
    } else {
        status_ = Status::Ready;
    }
}

void NetClient::handleProfile(ByteReader& reader) {
    Profile next;
    next.username = reader.str();
    next.totalXp = reader.f64();
    next.level = reader.u16();
    next.stars = static_cast<int>(reader.u32());

    const std::uint16_t stackCount = reader.u16();
    next.inventory.reserve(stackCount);
    for (std::uint16_t i = 0; i < stackCount; ++i) {
        Profile::Stack stack;
        stack.petalIndex = reader.u16();
        stack.rarity = clampRarity(reader.u8());
        stack.count = reader.u32();
        next.inventory.push_back(stack);
    }

    const std::uint8_t slotCount = reader.u8();
    next.loadout.reserve(slotCount);
    for (std::uint8_t i = 0; i < slotCount; ++i) {
        Profile::Slot slot;
        slot.petalIndex = reader.u16();
        slot.rarity = clampRarity(reader.u8());
        next.loadout.push_back(slot);
    }

    // Replace wholesale only once the whole message decoded. A partially
    // applied inventory is how duplication bugs start.
    if (!reader.ok()) return;
    profile_ = std::move(next);
}

void NetClient::handleJoinAccepted(ByteReader& reader) {
    const std::uint32_t selfNetId = reader.u32();
    const Vec2 spawn = reader.position();
    reader.u32();   // tick, informational
    if (!reader.ok()) return;

    (void)selfNetId;
    (void)spawn;
    status_ = Status::Playing;
    dead_ = false;
    view_.clear();
}

void NetClient::handleChat(ByteReader& reader) {
    ChatLine line;
    line.channel = static_cast<net::ChatChannel>(reader.u8());
    line.author = reader.str();
    line.text = reader.str();
    line.receivedAtMillis = nowMillis();
    if (!reader.ok()) return;

    chat_.push_back(std::move(line));
    if (chat_.size() > kMaxChatLines) {
        chat_.erase(chat_.begin(),
                    chat_.begin() + static_cast<std::ptrdiff_t>(chat_.size() - kMaxChatLines));
    }
}

void NetClient::handleNotice(ByteReader& reader) {
    Notice notice;
    notice.severity = static_cast<net::NoticeSeverity>(reader.u8());
    notice.text = reader.str();
    notice.receivedAtMillis = nowMillis();
    if (!reader.ok()) return;
    notices_.push_back(std::move(notice));
}

void NetClient::handleDied(ByteReader& reader) {
    killerName_ = reader.str();
    reader.u32();   // xp lost
    reader.u32();   // ticks survived
    if (!reader.ok()) return;
    dead_ = true;
}

void NetClient::handlePong(ByteReader& reader) {
    const std::uint64_t sentAt = reader.u64();
    reader.u64();   // server time
    if (!reader.ok()) return;
    pingMillis_ = nowMillis() - static_cast<double>(sentAt);
}

void NetClient::handleKick(ByteReader& reader) {
    const std::string reason = reader.str();
    if (!reader.ok()) return;
    lastError_ = reason;
    status_ = Status::Failed;
    dialer_.disconnect();
}

} // namespace flr
