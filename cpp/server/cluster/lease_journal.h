#pragma once
// A simulation server's own record of the rows lent to it.
//
// A client of a sharded game is connected to the server its flower is on, and
// that server writes to it directly: nothing passes through the gateway on
// the way. So the gateway can no longer promise that it holds a row before the
// byte that shows the row leaves, as it did when every byte was its own to
// send. This file is what makes that promise instead. Every row the server
// puts on the link is written here first, before any byte leaves for a client
// (net::Listener::beforeWrite), and stays until the gateway says it has taken
// it into its own journal (ToServer::RowsTaken). A server that dies, or loses
// the gateway, finds here what its players were shown and the gateway never
// heard, and hands it over when it is linked again (ToGateway::Recovered).
//
// What is handed over is a DIFFERENCE (cluster/row_merge.h): the row as the
// gateway last took it, against the row as the players last saw it. The
// gateway may have lent the row out again in between, so the difference lands
// on whatever it holds now, amounts added and values set.
//
// One JSON line per entry: {"s":seq,"u":user,"l":lease,"k":kind,"r":row}.
// `kind` is "g" for the row as the gateway lent it, "r" for a row this server
// changed, "e" for the row as it was handed back. A torn last line is dropped
// on reading: whatever it held, nobody was shown.

#include <cstdint>
#include <map>
#include <string>
#include <vector>

namespace flix::cluster {

class LeaseJournal {
public:
    ~LeaseJournal();

    /// Opens the file at `path`, reading what an earlier run left in it. An
    /// empty path keeps everything in memory: a test, or a server with no
    /// disk of its own.
    bool open(const std::string& path, std::string& errorOut);
    void close();

    /// The row as the gateway lent it. Not a change: the gateway has it.
    std::uint64_t granted(const std::string& user, std::uint32_t lease, const std::string& row);
    /// A row this server changed, about to go on the link.
    std::uint64_t changed(const std::string& user, std::uint32_t lease, const std::string& row);
    /// The row as it is handed back with its lease.
    std::uint64_t returned(const std::string& user, std::uint32_t lease, const std::string& row);

    /// Writes what has been recorded since the last call. Called before any
    /// byte leaves for a client. False when the write failed; what it held is
    /// kept and written by the next call.
    bool flush();
    /// fdatasync on a timer, as the database's journal does.
    void sync(double nowMillis);

    /// The gateway has everything up to `seq` in its own journal.
    void taken(std::uint64_t seq);
    /// The last entry recorded.
    std::uint64_t lastSeq() const { return seq_; }
    /// Numbers from past `seq` from here on: the gateway remembers having
    /// taken that much, and a server whose file was lost must not reuse them.
    void startFrom(std::uint64_t seq);
    /// Every lease recorded so far is over (the link went, and every row on
    /// loan with it): each is dropped once the gateway has taken its last row.
    void closeAll();

    /// A row whose last state the gateway has not taken.
    struct Recovery {
        std::string user;
        std::uint32_t lease = 0;
        /// The row as the gateway last took it (or lent it).
        std::string base;
        /// The row as its player last saw it.
        std::string row;
    };
    /// Every row with entries past `takenSeq`, as of the last of them.
    std::vector<Recovery> unacknowledged(std::uint64_t takenSeq) const;

    /// Rewritten when it has grown past this and the gateway has taken most of
    /// it.
    static constexpr std::uint64_t kCompactBytes = 4ull << 20;
    static constexpr double kSyncMillis = 1000.0;

private:
    struct Entry {
        std::uint64_t seq = 0;
        char kind = 'r';
        std::uint32_t lease = 0;
        std::string row;
    };
    /// One lease of one account: its entries since it was granted.
    struct Chain {
        std::uint32_t lease = 0;
        std::vector<Entry> entries;
        bool closed = false;
        bool ended() const { return closed || (!entries.empty() && entries.back().kind == 'e'); }
    };

    std::uint64_t record(char kind, const std::string& user, std::uint32_t lease, const std::string& row);
    static std::string line(const std::string& user, const Entry& entry);
    void compact();

    std::string path_;
    int fd_ = -1;
    std::uint64_t bytes_ = 0;
    std::string backlog_;
    std::uint64_t seq_ = 0;
    std::uint64_t taken_ = 0;
    std::map<std::string, Chain> chains_;
    bool unsynced_ = false;
    double lastSyncMillis_ = 0;
    int syncTicket_ = 0;
};

} // namespace flix::cluster
