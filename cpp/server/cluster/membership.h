#pragma once
// What a server remembers of being linked to others: the file an admin command
// writes and every start reads.
//
// Kept beside the database (`inventory.json.cluster`) and not in it, because
// the database is copied to every server of a cluster and this is exactly what
// is NOT the same on each: which one it is, whom it dials, and the key --
// which is readable by whoever runs the server and by nobody in the game.

#include <cstdint>
#include <string>

namespace flix::cluster {

/// The port servers once linked on, apart from the game's. A file written
/// then has it; servers link on the game's own port now.
inline constexpr std::uint16_t kOldLinkPort = 3100;

struct Membership {
    /// `Alone` is a server of one, with or without a key to be linked by.
    enum class Role : std::uint8_t { Alone, Gateway, Shard };
    Role role = Role::Alone;
    std::string key;
    std::string name;
    /// See cluster::Greeting::id.
    std::string id;
    /// A shard: whom it dials -- the gateway's game port.
    std::string gatewayHost;
    std::uint16_t gatewayPort = 3000;
    /// Read from a file written when servers linked on a port of their own:
    /// `gatewayPort` is that port, not the gateway's game port (ServerHost
    /// moves it).
    bool oldLinkPort = false;

    /// Reads `path`. A missing file is a server that has never been linked; a
    /// file that cannot be read is said in `note` and taken for one too.
    static Membership load(const std::string& path, std::string& note);
    bool save(const std::string& path, std::string& errorOut) const;
};

/// Where a server keeps it, and where it keeps the copy of the cluster's
/// database that it is sent -- beside its own, never over it.
std::string membershipPathFor(const std::string& databasePath);
std::string copyPathFor(const std::string& databasePath);

/// "host", "host:port" into its parts. False for neither.
bool parseAddress(const std::string& text, std::string& host, std::uint16_t& port);

/// Makes this server the cluster's gateway out of the copy it was sent: its
/// own database is moved aside (the new name in `note`), the copy and its
/// journal take its place, and the membership is rewritten. For when the
/// gateway is not coming back. False, with nothing moved, when there is no
/// whole copy here to do it with.
bool promote(const std::string& databasePath, std::string& note);

/// Makes the server whose database is at `databasePath` a server of one again,
/// its key kept: for a linked server whose gateway is gone, and which nobody
/// can therefore sign in to and tell. False, with why, when it is not linked.
bool unlink(const std::string& databasePath, std::string& note);

/// Moves the database at `path`, with its journal, to
/// `database_independent.json` in the same directory -- or, with one there
/// already, `database_independent-2.json` and so on, since that is a database
/// too. Empty, with nothing moved, when it could not be. What anything about to
/// put another database at `path` does first.
std::string setAside(const std::string& path);

/// Whether the file at `path`, if there is one, is an earlier state of the
/// database known by `lineage`, kept here by this server: the one thing a copy
/// of that database may be saved over. `<path>.of` says so.
bool isCopyOf(const std::string& path, const std::string& lineage);
bool markCopyOf(const std::string& path, const std::string& lineage);
/// Says the copy is of a cluster this server has left, so that no promotion
/// takes it for the one it is joining's.
void retireCopy(const std::string& databasePath);

} // namespace flix::cluster
