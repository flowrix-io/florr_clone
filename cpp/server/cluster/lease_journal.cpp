#include "server/cluster/lease_journal.h"

#include <cerrno>
#include <cstdio>
#include <fcntl.h>
#include <iterator>
#include <unistd.h>

#include "server/durable_file.h"
#include "shared/core/json.h"

namespace flix::cluster {

LeaseJournal::~LeaseJournal() { close(); }

void LeaseJournal::close() {
    flush();
    if (fd_ >= 0) ::close(fd_);
    fd_ = -1;
}

bool LeaseJournal::open(const std::string& path, std::string& errorOut) {
    close();
    path_ = path;
    chains_.clear();
    backlog_.clear();
    bytes_ = 0;
    if (path_.empty()) return true;
    if (std::FILE* file = std::fopen(path_.c_str(), "rb")) {
        std::string text;
        char chunk[64 * 1024];
        std::size_t n = 0;
        while ((n = std::fread(chunk, 1, sizeof chunk, file)) > 0) text.append(chunk, n);
        std::fclose(file);
        std::size_t at = 0;
        std::size_t kept = 0;
        while (at < text.size()) {
            const std::size_t end = text.find('\n', at);
            // A torn last line: nobody was shown what it held.
            if (end == std::string::npos) break;
            const Json entry = Json::parseOrNull(text.substr(at, end - at));
            at = end + 1;
            if (!entry.isObject() || !entry["u"].isString() || !entry["r"].isString()) continue;
            kept = at;
            Entry e;
            e.seq = static_cast<std::uint64_t>(entry["s"].asDouble());
            e.lease = static_cast<std::uint32_t>(entry["l"].asDouble());
            const std::string kind = entry["k"].asString();
            e.kind = kind.empty() ? 'r' : kind[0];
            e.row = entry["r"].asString();
            if (e.seq > seq_) seq_ = e.seq;
            Chain& chain = chains_[entry["u"].asString()];
            if (e.kind == 'g' || chain.lease != e.lease) chain = Chain{e.lease, {}};
            chain.entries.push_back(std::move(e));
        }
        bytes_ = kept;
    }
    fd_ = ::open(path_.c_str(), O_WRONLY | O_CREAT | O_APPEND, 0600);
    if (fd_ < 0) {
        errorOut = "cannot open " + path_ + " for writing";
        return false;
    }
    // Whatever was torn off the end goes before anything is appended to it.
    if (::ftruncate(fd_, static_cast<off_t>(bytes_)) != 0) {
        errorOut = "cannot trim " + path_;
        return false;
    }
    return true;
}

std::string LeaseJournal::line(const std::string& user, const Entry& entry) {
    Json j = Json::object();
    j["s"] = Json(static_cast<double>(entry.seq));
    j["u"] = Json(user);
    j["l"] = Json(static_cast<double>(entry.lease));
    j["k"] = Json(std::string(1, entry.kind));
    j["r"] = Json(entry.row);
    return j.dump(0) + "\n";
}

std::uint64_t LeaseJournal::record(char kind, const std::string& user, std::uint32_t lease,
                                   const std::string& row) {
    Entry e;
    e.seq = ++seq_;
    e.kind = kind;
    e.lease = lease;
    e.row = row;
    if (!path_.empty()) backlog_ += line(user, e);
    Chain& chain = chains_[user];
    if (kind == 'g' || chain.lease != lease) chain = Chain{lease, {}};
    // Kept until the gateway has taken a later one (see taken()): whichever
    // it took last is the base of what is handed over, and an acknowledgement
    // can land between any two of them.
    chain.entries.push_back(std::move(e));
    return seq_;
}

std::uint64_t LeaseJournal::granted(const std::string& user, std::uint32_t lease,
                                    const std::string& row) {
    return record('g', user, lease, row);
}

std::uint64_t LeaseJournal::changed(const std::string& user, std::uint32_t lease,
                                    const std::string& row) {
    return record('r', user, lease, row);
}

std::uint64_t LeaseJournal::returned(const std::string& user, std::uint32_t lease,
                                     const std::string& row) {
    return record('e', user, lease, row);
}

bool LeaseJournal::flush() {
    if (backlog_.empty() || fd_ < 0) return backlog_.empty() || path_.empty();
    if (!durable::appendWhole(fd_, bytes_, backlog_)) {
        std::fprintf(stderr, "[cluster] could not write the lease journal %s\n", path_.c_str());
        return false;
    }
    backlog_.clear();
    unsynced_ = true;
    return true;
}

void LeaseJournal::sync(double nowMillis) {
    if (!unsynced_ || fd_ < 0 || nowMillis - lastSyncMillis_ < kSyncMillis) return;
    if (syncTicket_ != 0 && durable::syncState(syncTicket_) == 0) return;
    syncTicket_ = durable::beginSync(path_);
    lastSyncMillis_ = nowMillis;
    unsynced_ = false;
}

void LeaseJournal::startFrom(std::uint64_t seq) {
    if (seq > seq_) seq_ = seq;
}

void LeaseJournal::closeAll() {
    for (auto& entry : chains_) entry.second.closed = true;
    // Already taken, all of it.
    for (auto it = chains_.begin(); it != chains_.end();) {
        const Chain& chain = it->second;
        it = chain.entries.empty() || chain.entries.back().seq <= taken_ ? chains_.erase(it) : std::next(it);
    }
}

void LeaseJournal::taken(std::uint64_t seq) {
    if (seq <= taken_) return;
    taken_ = seq;
    for (auto it = chains_.begin(); it != chains_.end();) {
        Chain& chain = it->second;
        // Over, and the gateway has the row as it ended: done.
        if (chain.ended() && (chain.entries.empty() || chain.entries.back().seq <= taken_)) {
            it = chains_.erase(it);
            continue;
        }
        // The last entry the gateway has is the base for anything after it.
        std::size_t base = 0;
        for (std::size_t i = 0; i < chain.entries.size(); ++i) {
            if (chain.entries[i].seq <= taken_) base = i;
        }
        chain.entries.erase(chain.entries.begin(), chain.entries.begin() + static_cast<std::ptrdiff_t>(base));
        ++it;
    }
    compact();
}

void LeaseJournal::compact() {
    if (fd_ < 0 || bytes_ + backlog_.size() < kCompactBytes) {
        if (fd_ >= 0 && chains_.empty() && backlog_.empty() && bytes_ > 0) {
            // Nothing anybody could ask for: start the file again.
            if (::ftruncate(fd_, 0) == 0) bytes_ = 0;
        }
        return;
    }
    std::string text;
    for (const auto& [user, chain] : chains_) {
        for (const Entry& entry : chain.entries) text += line(user, entry);
    }
    const std::string next = path_ + ".next";
    int fd = ::open(next.c_str(), O_WRONLY | O_CREAT | O_TRUNC, 0600);
    std::uint64_t length = 0;
    if (fd < 0 || !durable::appendWhole(fd, length, text)) {
        if (fd >= 0) ::close(fd);
        std::remove(next.c_str());
        return;
    }
    ::fsync(fd);
    ::close(fd);
    if (std::rename(next.c_str(), path_.c_str()) != 0) {
        std::remove(next.c_str());
        return;
    }
    ::close(fd_);
    fd_ = ::open(path_.c_str(), O_WRONLY | O_APPEND);
    bytes_ = length;
    backlog_.clear();
}

std::vector<LeaseJournal::Recovery> LeaseJournal::unacknowledged(std::uint64_t takenSeq) const {
    std::vector<Recovery> out;
    for (const auto& [user, chain] : chains_) {
        if (chain.entries.empty()) continue;
        const Entry& last = chain.entries.back();
        if (last.seq <= takenSeq || last.kind == 'g') continue;
        // The base: the last entry the gateway took, or the row as it lent it.
        const Entry* base = &chain.entries.front();
        for (const Entry& entry : chain.entries) {
            if (entry.seq <= takenSeq || entry.kind == 'g') base = &entry;
        }
        if (base == &last || base->row == last.row) continue;
        out.push_back(Recovery{user, chain.lease, base->row, last.row});
    }
    return out;
}

} // namespace flix::cluster
