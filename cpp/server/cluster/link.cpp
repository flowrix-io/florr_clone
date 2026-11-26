#include "server/cluster/link.h"

#include <algorithm>

#include "server/crypto.h"
#include "shared/game/config.h"

namespace flix::cluster {

namespace {

void writeRealm(ByteWriter& w, Realm realm) { w.u8(static_cast<std::uint8_t>(realm)); }
Realm readRealm(ByteReader& r) { return realmFromByte(r.u8()); }

/// A point that has to survive the trip exactly: position() is an f32 pair.
void writePoint(ByteWriter& w, Vec2 p) {
    w.f64(p.x);
    w.f64(p.y);
}
Vec2 readPoint(ByteReader& r) {
    const double x = r.f64();
    const double y = r.f64();
    return {x, y};
}

void hmacSha256(const std::string& key, const std::string& message, std::uint8_t digest[32]) {
    std::uint8_t block[64] = {};
    if (key.size() > sizeof block) {
        crypto::sha256(key.data(), key.size(), block);
    } else {
        std::copy(key.begin(), key.end(), block);
    }
    std::uint8_t inner[64];
    std::uint8_t outer[64];
    for (std::size_t i = 0; i < sizeof block; ++i) {
        inner[i] = block[i] ^ 0x36;
        outer[i] = block[i] ^ 0x5c;
    }
    crypto::Sha256 first;
    first.update(inner, sizeof inner);
    first.update(message);
    first.finish(digest);
    crypto::Sha256 second;
    second.update(outer, sizeof outer);
    second.update(digest, 32);
    second.finish(digest);
}

void frameNonce(std::uint64_t counter, std::uint8_t nonce[12]) {
    std::fill(nonce, nonce + 4, std::uint8_t{0});
    for (int i = 0; i < 8; ++i) nonce[4 + i] = static_cast<std::uint8_t>(counter >> (8 * i));
}

} // namespace

std::string linkProof(const std::string& secret, const char* who, const std::string& nonce,
                      const std::string& otherNonce) {
    std::uint8_t digest[32];
    hmacSha256(secret, std::string(who) + '|' + nonce + '|' + otherNonce, digest);
    return crypto::toHex(digest, sizeof digest);
}

void LinkCipher::start(const std::string& secret, const std::string& serverNonce,
                       const std::string& gatewayNonce, bool gateway) {
    const std::string both = '|' + serverNonce + '|' + gatewayNonce;
    hmacSha256(secret, "seal to gateway" + both, gateway ? receiveKey_ : sendKey_);
    hmacSha256(secret, "seal to server" + both, gateway ? sendKey_ : receiveKey_);
    sent_ = received_ = 0;
    started_ = true;
}

ByteWriter LinkCipher::seal(const ByteWriter& message) {
    if (!started_) return message;
    std::uint8_t nonce[12];
    frameNonce(sent_++, nonce);
    ByteWriter sealed(0);
    sealed.buffer().resize(message.size() + crypto::kAeadTagBytes);
    crypto::aeadSeal(sendKey_, nonce, nullptr, 0,
                     reinterpret_cast<const std::uint8_t*>(message.data()), message.size(),
                     reinterpret_cast<std::uint8_t*>(sealed.buffer().data()));
    return sealed;
}

bool LinkCipher::open(const std::byte* data, std::size_t size, std::vector<std::byte>& out) {
    if (!started_) {
        out.assign(data, data + size);
        return true;
    }
    if (size < crypto::kAeadTagBytes) return false;
    std::uint8_t nonce[12];
    frameNonce(received_, nonce);
    out.resize(size - crypto::kAeadTagBytes);
    if (!crypto::aeadOpen(receiveKey_, nonce, nullptr, 0,
                          reinterpret_cast<const std::uint8_t*>(data), size,
                          reinterpret_cast<std::uint8_t*>(out.data()))) {
        return false;
    }
    ++received_;
    return true;
}

Where whereHandled(net::ClientMessage id) {
    switch (id) {
        case net::ClientMessage::Input:
        case net::ClientMessage::Ping:
        case net::ClientMessage::UsePetal:
        case net::ClientMessage::SetLoadout:
        case net::ClientMessage::SwapLoadout:
        case net::ClientMessage::SwapLoadoutRows:
        case net::ClientMessage::SaveLoadoutPreset:
        case net::ClientMessage::LoadLoadoutPreset:
        case net::ClientMessage::ProfileCheck:
        case net::ClientMessage::Craft:
        case net::ClientMessage::OracleCraft:
        case net::ClientMessage::Trade:
        case net::ClientMessage::TitanForge:
        case net::ClientMessage::TitanHolder:
        case net::ClientMessage::Assemble:
        case net::ClientMessage::Absorb:
        case net::ClientMessage::UpgradeSkill:
        case net::ClientMessage::ResetSkills:
        case net::ClientMessage::ClaimTrialReward:
        case net::ClientMessage::StartTrialChamber:
        case net::ClientMessage::Respawn:
        case net::ClientMessage::AdminDashboard:
            return Where::There;
        // The handlers on the gateway that spend from the account, or change
        // what the body wears: run on the gateway's copy of the row, once
        // everything the client sent before them has been carried out on the
        // other's.
        case net::ClientMessage::BuyPetal:
        case net::ClientMessage::RedeemCode:
        case net::ClientMessage::PublishSkin:
        case net::ClientMessage::EditSkin:
        case net::ClientMessage::EquipSkin:
        case net::ClientMessage::DeleteSkin:
        case net::ClientMessage::VoteSkin:
        case net::ClientMessage::FavoriteSkin:
            return Where::Fenced;
        default:
            return Where::Here;
    }
}

bool awaitsGateway(net::ClientMessage id) {
    // The market's admin tools sell from the bag too.
    return whereHandled(id) == Where::Fenced || id == net::ClientMessage::AdminTools;
}

void Greeting::write(ByteWriter& w) const {
    w.u32(linkVersion);
    w.u16(protocol);
    w.u32(contentHash);
    w.str(name);
    w.str(id);
    w.str(nonce);
    w.boolean(probe);
    w.boolean(copy);
    w.boolean(local);
    w.str(publicHost);
    w.u16(publicPort);
    w.u16(port);
}

Greeting Greeting::read(ByteReader& r) {
    Greeting g;
    g.linkVersion = r.u32();
    g.protocol = r.u16();
    g.contentHash = r.u32();
    // Another version's greeting need not even be this shape past here.
    if (g.linkVersion != kLinkVersion) return g;
    g.name = r.str();
    g.id = r.str();
    g.nonce = r.str();
    g.probe = r.boolean();
    g.copy = r.boolean();
    g.local = r.boolean();
    g.publicHost = r.str();
    g.publicPort = r.u16();
    g.port = r.u16();
    return g;
}

std::string Greeting::digest() const {
    ByteWriter w;
    write(w);
    std::uint8_t digest[32];
    crypto::sha256(w.data(), w.size(), digest);
    return crypto::toHex(digest, sizeof digest);
}

std::string Greeting::refusal() const {
    if (linkVersion != kLinkVersion || protocol != net::kProtocolVersion) {
        return "it is another build: update both to the same one";
    }
    if (contentHash != content().contentHash()) return "its game content does not match";
    if (nonce.size() < 16) return "malformed greeting";
    return {};
}

void ClientInfo::write(ByteWriter& w) const {
    w.str(userId);
    w.str(username);
    w.str(address);
    w.str(displayName);
    w.str(spawnChoice);
    w.boolean(admin);
    w.i32(adminTier);
    w.i32(grantTier);
    w.str(grantedBy);
    w.str(elsewhere);
}

ClientInfo ClientInfo::read(ByteReader& r) {
    ClientInfo c;
    c.userId = r.str();
    c.username = r.str();
    c.address = r.str();
    c.displayName = r.str();
    c.spawnChoice = r.str();
    c.admin = r.boolean();
    c.adminTier = r.i32();
    c.grantTier = r.i32();
    c.grantedBy = r.str();
    c.elsewhere = r.str();
    return c;
}

void FlowerState::write(ByteWriter& w) const {
    w.u8(static_cast<std::uint8_t>(how));
    writeRealm(w, realm);
    writePoint(w, position);
    w.str(displayName);
    w.str(spawnChoice);
    w.boolean(prestige);
    w.i32(trialFloor);
    w.f64(viewWidth);
    w.f64(viewHeight);
    w.boolean(arenaAdmitted);
    w.boolean(arenaReturn);
    writeRealm(w, arenaReturnRealm);
    writePoint(w, arenaReturnPosition);
    w.str(arenaReturnChoice);
    w.boolean(dead);
    w.f64(angle);
    w.f64(health);
    w.f64(shield);
    w.f64(mana);
    w.f64(invulnerableLeft);
    w.boolean(god);
    w.boolean(phase);
    w.f64(splitLeft);
    w.u32(inputSequence);
    w.u8(static_cast<std::uint8_t>(ring.size()));
    for (const RingSlot& slot : ring) {
        w.u16(slot.petal);
        w.u8(slot.rarity);
        w.boolean(slot.broken);
        w.f64(slot.reloadLeft);
        w.f64(slot.health);
        w.u8(static_cast<std::uint8_t>(std::min<std::size_t>(slot.grainsLeft.size(), 64)));
        for (std::size_t i = 0; i < slot.grainsLeft.size() && i < 64; ++i) w.f32(slot.grainsLeft[i]);
    }
}

FlowerState FlowerState::read(ByteReader& r) {
    FlowerState s;
    s.how = static_cast<How>(std::min<std::uint8_t>(r.u8(), static_cast<std::uint8_t>(How::Walk)));
    s.realm = readRealm(r);
    s.position = readPoint(r);
    s.displayName = r.str();
    s.spawnChoice = r.str();
    s.prestige = r.boolean();
    s.trialFloor = r.i32();
    s.viewWidth = r.f64();
    s.viewHeight = r.f64();
    s.arenaAdmitted = r.boolean();
    s.arenaReturn = r.boolean();
    s.arenaReturnRealm = readRealm(r);
    s.arenaReturnPosition = readPoint(r);
    s.arenaReturnChoice = r.str();
    s.dead = r.boolean();
    s.angle = r.f64();
    s.health = r.f64();
    s.shield = r.f64();
    s.mana = r.f64();
    s.invulnerableLeft = r.f64();
    s.god = r.boolean();
    s.phase = r.boolean();
    s.splitLeft = r.f64();
    s.inputSequence = r.u32();
    const int slots = r.u8();
    for (int i = 0; i < slots && r.ok(); ++i) {
        RingSlot slot;
        slot.petal = r.u16();
        slot.rarity = r.u8();
        slot.broken = r.boolean();
        slot.reloadLeft = r.f64();
        slot.health = r.f64();
        const int grains = r.u8();
        for (int g = 0; g < grains && r.ok(); ++g) slot.grainsLeft.push_back(r.f32());
        s.ring.push_back(std::move(slot));
    }
    return s;
}

void ClientState::write(ByteWriter& w) const {
    w.boolean(playing);
    w.boolean(dead);
    w.boolean(split);
    w.boolean(arena);
    w.boolean(eventKit);
    w.boolean(controlled);
    writeRealm(w, realm);
    w.u32(netId);
    w.i32(level);
    w.f64(oracleWait);
    w.f64(traderWait);
}

ClientState ClientState::read(ByteReader& r) {
    ClientState s;
    s.playing = r.boolean();
    s.dead = r.boolean();
    s.split = r.boolean();
    s.arena = r.boolean();
    s.eventKit = r.boolean();
    s.controlled = r.boolean();
    s.realm = readRealm(r);
    s.netId = r.u32();
    s.level = r.i32();
    s.oracleWait = r.f64();
    s.traderWait = r.f64();
    return s;
}

void SquadState::write(ByteWriter& w) const {
    w.str(id);
    w.boolean(isPublic);
    w.u32(leader);
    w.u8(static_cast<std::uint8_t>(members.size()));
    for (const net::ConnectionId member : members) w.u32(member);
}

SquadState SquadState::read(ByteReader& r) {
    SquadState s;
    s.id = r.str();
    s.isPublic = r.boolean();
    s.leader = r.u32();
    const int n = r.u8();
    for (int i = 0; i < n && r.ok(); ++i) s.members.push_back(r.u32());
    return s;
}

void ServerStats::write(ByteWriter& w) const {
    w.f64(tickMillis);
    w.u8(static_cast<std::uint8_t>(realms.size()));
    for (const RealmLoad& load : realms) {
        writeRealm(w, load.realm);
        w.u16(load.humans);
        w.u16(load.flowers);
        w.u32(load.mobs);
        w.boolean(load.boss);
    }
    w.u8(static_cast<std::uint8_t>(clocks.size()));
    for (const BossClock& clock : clocks) {
        w.str(clock.biome);
        w.f64(clock.uniqueLeft);
        w.f64(clock.apexLeft);
    }
}

ServerStats ServerStats::read(ByteReader& r) {
    ServerStats s;
    s.tickMillis = r.f64();
    const int realms = r.u8();
    for (int i = 0; i < realms && r.ok(); ++i) {
        RealmLoad load;
        load.realm = readRealm(r);
        load.humans = r.u16();
        load.flowers = r.u16();
        load.mobs = r.u32();
        load.boss = r.boolean();
        s.realms.push_back(load);
    }
    const int clocks = r.u8();
    for (int i = 0; i < clocks && r.ok(); ++i) {
        BossClock clock;
        clock.biome = r.str();
        clock.uniqueLeft = r.f64();
        clock.apexLeft = r.f64();
        s.clocks.push_back(std::move(clock));
    }
    return s;
}

} // namespace flix::cluster
