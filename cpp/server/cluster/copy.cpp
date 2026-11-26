// The database, copied to every server of a cluster.
//
// The gateway's is the database: it is the one written to. Every other server
// is sent all of it when it joins and every change from then on, and keeps
// that on its own disk as a file any build can open -- so losing the gateway's
// machine is losing a machine and not the accounts (cluster::promote).
//
// The first pass and the changes are one kind of message: rows, whole, as
// their text. A row goes out in the first pass as it stands when its turn
// comes, and again whenever it changes after that, on one ordered link; so
// whatever moment each was read at, the copy ends on every row's last state.
// The changes are gathered for half a second at a time, because a playing
// flower's row changes most ticks and is many kilobytes long. That is what a
// copy may be behind by. cpp/docs/ARCHITECTURE.md, "Sharding".

#include <algorithm>
#include <cstdio>

#include "server/cluster/gateway.h"
#include "server/cluster/membership.h"
#include "server/cluster/shard.h"
#include "server/crypto.h"

namespace flix {

using cluster::ToGateway;
using cluster::ToServer;

namespace {

constexpr double kCopyIntervalMillis = 500.0;
/// One message's worth of rows, and what a tick puts on one link.
constexpr std::size_t kCopyBatchBytes = 256u << 10;
/// A link with this much waiting is given no more of a first pass.
constexpr std::size_t kCopyBacklogBytes = 2u << 20;
constexpr double kCopySaveIntervalMillis = 30000.0;
constexpr double kCopySaveSliceMillis = 2.0;

void putRowRef(ByteWriter& w, const Database& database, Database::Part part, const std::string& key) {
    std::string text;
    const bool exists = database.rowText(part, key, text);
    w.u8(static_cast<std::uint8_t>(part));
    w.str(key);
    w.boolean(exists);
    if (exists) w.blob(text);
}

/// What tells one database from another, and a copy of it from a stranger's.
/// Hashed, since the secret itself is nobody's to find in a second file.
std::string copyLineage(const Database& copy) {
    std::string secret;
    if (!copy.rowText(Database::Part::Tables, "ipSalt", secret)) return {};
    return crypto::sha256Hex("copy of " + secret);
}

bool databaseAt(const std::string& path) {
    for (const char* suffix : {"", ".journal", ".journal.next"}) {
        std::FILE* file = std::fopen((path + suffix).c_str(), "rb");
        if (file == nullptr) continue;
        std::fclose(file);
        return true;
    }
    return false;
}

} // namespace

// -- the gateway -------------------------------------------------------------

void GameServer::gwBeginCopy(int slot) {
    Gateway::Server& server = *gateway_->bySlot(slot);
    // There to tell this database's copies by: one not yet made is made now.
    database_.serverSecret();
    ByteWriter w;
    w.u8(static_cast<std::uint8_t>(ToServer::CopyBegin));
    gwSend(server.slot, w);
    server.copy = database_.everyRow();
    server.copied = 0;
    server.copySent = server.copyOnDisk = 0;
    server.copying = true;
    std::printf("[cluster] copying the database to %s (%zu rows)\n", server.name.c_str(),
                server.copy.size());
}

void GameServer::gwServiceCopies(double now, bool everything) {
    Gateway& g = *gateway_;
    const auto send = [&](Gateway::Server& server, std::uint16_t count, const ByteWriter& rows) {
        ByteWriter w;
        w.u8(static_cast<std::uint8_t>(ToServer::CopyRows));
        w.u64(++server.copySent);
        w.u16(count);
        w.raw(rows.data(), rows.size());
        gwSend(server.slot, w);
    };

    // The first passes, a slice of each a tick.
    for (auto& entry : g.servers) {
        Gateway::Server& server = entry.second;
        if (!server.copying || server.copied >= server.copy.size()) continue;
        net::Connection* link = g.door.find(entry.first);
        if (link == nullptr || (link->pendingBytes() > kCopyBacklogBytes && !everything)) continue;
        ByteWriter rows;
        std::uint16_t count = 0;
        while (server.copied < server.copy.size() && rows.size() < kCopyBatchBytes && count < 0xFFFF) {
            const auto& [part, key] = server.copy[server.copied++];
            putRowRef(rows, database_, part, key);
            ++count;
        }
        send(server, count, rows);
        if (server.copied < server.copy.size()) continue;
        server.copy.clear();
        server.copy.shrink_to_fit();
        server.copied = 0;
        ByteWriter w;
        w.u8(static_cast<std::uint8_t>(ToServer::CopyComplete));
        w.u64(++server.copySent);
        gwSend(server.slot, w);
    }

    if (now < g.nextCopyMillis && !everything) return;
    g.nextCopyMillis = now + kCopyIntervalMillis;
    ByteWriter rows;
    std::uint16_t count = 0;
    const auto flush = [&] {
        if (count == 0) return;
        for (auto& entry : g.servers) {
            if (entry.second.copying) send(entry.second, count, rows);
        }
        rows.clear();
        count = 0;
    };
    for (std::size_t part = 0; part < g.changed.size(); ++part) {
        for (const std::string& key : g.changed[part]) {
            putRowRef(rows, database_, static_cast<Database::Part>(part), key);
            if (++count == 0xFFFF || rows.size() >= kCopyBatchBytes) flush();
        }
        g.changed[part].clear();
    }
    flush();
}

std::string GameServer::gwCopyState(int slot) const {
    const Gateway::Server& server = *gateway_->bySlot(slot);
    if (server.greeting.local) return "this one";
    if (!server.copying) return "no copy kept";
    if (!server.copy.empty()) {
        return "copying, " + std::to_string(server.copied * 100 / server.copy.size()) + "%";
    }
    const std::uint64_t behind = server.copySent - std::min(server.copySent, server.copyOnDisk);
    return behind == 0 ? "copied, up to date"
                       : "copied, " + std::to_string(behind) + " batch" + (behind == 1 ? "" : "es") + " behind";
}

// -- a server ----------------------------------------------------------------

void GameServer::shCopyMessage(std::uint8_t message, ByteReader& reader) {
    Shard& s = *shard_;
    if (config_.copyPath.empty()) return;
    switch (static_cast<ToServer>(message)) {
        case ToServer::CopyBegin:
            // The last copy's final save, if it has one to make, and then a
            // new one that touches nothing on disk until it is whole.
            s.copy.reset();
            s.copy = std::make_unique<Database>();
            s.copy->openCopy();
            s.copyWhole = false;
            s.copyTaken = s.copyAcked = 0;
            break;
        case ToServer::CopyRows: {
            if (!s.copy) break;
            const std::uint64_t seq = reader.u64();
            for (int n = reader.u16(); n > 0 && reader.ok(); --n) {
                const auto part = static_cast<Database::Part>(std::min<std::uint8_t>(reader.u8(), 3));
                const std::string key = reader.str();
                const bool exists = reader.boolean();
                std::string text = exists ? reader.blob() : std::string();
                if (!reader.ok()) break;
                if (exists) s.copy->putRow(part, key, std::move(text));
                else s.copy->eraseRow(part, key);
            }
            s.copyTaken = seq;
            break;
        }
        case ToServer::CopyComplete:
            if (!s.copy) break;
            s.copyTaken = reader.u64();
            s.copyLineage = copyLineage(*s.copy);
            s.copyFiled = false;
            // A database is never written over, only an earlier state of the
            // same one. Whatever else has the name keeps its contents.
            if (!cluster::isCopyOf(config_.copyPath, s.copyLineage) && databaseAt(config_.copyPath)) {
                const std::string aside = cluster::setAside(config_.copyPath);
                if (aside.empty()) {
                    std::fprintf(stderr, "[cluster] no copy is kept: the database at %s could not be moved aside\n",
                                 config_.copyPath.c_str());
                    s.copy.reset();
                    break;
                }
                std::printf("[cluster] the database at %s is now %s\n", config_.copyPath.c_str(), aside.c_str());
            }
            s.copyWhole = true;
            s.copy->copyComplete(config_.copyPath);
            s.nextCopySaveMillis = monotonicMillis() + kCopySaveIntervalMillis;
            break;
        default: break;
    }
}

void GameServer::shServiceCopy(double now) {
    Shard& s = *shard_;
    if (!s.copy || !s.copyWhole) return;
    Database& copy = *s.copy;
    copy.flushJournal();
    if (now >= s.nextCopySaveMillis) {
        s.nextCopySaveMillis = now + kCopySaveIntervalMillis;
        if (!copy.backgroundSaveRunning()) copy.beginBackgroundSave();
    }
    const Database::SaveProgress progress = copy.serviceBackgroundSave(kCopySaveSliceMillis);
    if (progress == Database::SaveProgress::Saved) {
        if (!s.copyFiled && !cluster::markCopyOf(config_.copyPath, s.copyLineage)) {
            std::fprintf(stderr, "[cluster] %s.of was not written\n", config_.copyPath.c_str());
        }
        if (!s.copyFiled) std::printf("[cluster] the database is copied to %s\n", config_.copyPath.c_str());
        s.copyFiled = true;
        copy.flushJournal();
    } else if (progress == Database::SaveProgress::Failed) {
        std::fprintf(stderr, "[cluster] the database copy was not saved (%s); trying again\n",
                     copy.backgroundSaveError().c_str());
        // Nothing to journal behind until there is a file: soon, then.
        if (!s.copyFiled) s.nextCopySaveMillis = now + 1000.0;
    }
    copy.syncJournal(static_cast<std::int64_t>(now));
    if (s.copyFiled && s.copyAcked != s.copyTaken && !copy.wantsSaveNow()) {
        s.copyAcked = s.copyTaken;
        ByteWriter w;
        w.u8(static_cast<std::uint8_t>(ToGateway::CopyAck));
        w.u64(s.copyAcked);
        shSend(w);
    }
}

} // namespace flix
