#pragma once
// Which server simulates which biome.
//
// A sharded game's biomes are dealt over its servers, each biome on exactly
// one, and NO SERVER IS EVER GIVEN ALL OF THEM -- one server down to its last
// breath still leaves the rest of the map to somebody else. Beyond that rule,
// the busiest biome gets the quietest server, and a server that stays busier
// than the others hands a biome over.
//
// All of it is plain arithmetic over the numbers the servers report, with no
// socket and no world in it, so the rules can be tested as rules.

#include <string>
#include <vector>

namespace flix::cluster {

/// One biome, as the placement sees it.
struct BiomeLoad {
    /// The server it is on (an index into the servers), or -1 for none.
    int server = -1;
    /// What simulating it costs, in milliseconds of tick; estimated from the
    /// last reports, and a guess from the size of its maps before any.
    double cost = 0.0;
    /// People in it. A biome with none moves without anybody noticing.
    int humans = 0;
    /// Being handed over, or holding something a move would lose (an eternal or
    /// an apex standing in it): left where it is.
    bool pinned = false;
    /// The server an admin has assigned it to, or -1 for wherever it is best.
    /// Home while that server is up; anywhere, meanwhile, while it is not.
    int home = -1;
};

struct ServerLoad {
    bool up = true;
    /// Its measured tick, in milliseconds: what "overloaded" is read from.
    double tickMillis = 0.0;
    /// May be dealt every biome: the gateway's own simulation, when it is the
    /// only server players can reach. Any other is never given all of them.
    bool takesAll = false;
};

struct Move {
    int biome = -1;
    int to = -1;
};

/// Where every biome with no server -- or one that is no longer up -- should
/// go: heaviest first, each to the server with the least to do, never the
/// last biome to a server that would then hold them all. A biome the rule
/// leaves over stays at -1 and is offered again when a server joins.
std::vector<Move> placeOrphans(const std::vector<BiomeLoad>& biomes,
                               const std::vector<ServerLoad>& servers);

/// Every biome that is on one server and assigned to another that is up, with
/// somewhere to put it: an admin's word, so it waits for nobody to leave it.
std::vector<Move> homecomings(const std::vector<BiomeLoad>& biomes,
                              const std::vector<ServerLoad>& servers);

/// The one move that best evens the load, or none. A biome that is home is
/// left there.
///
/// A biome nobody is in moves whenever that closes a real gap. One with people
/// in it moves only off a server that is struggling (kOverloadedTickMillis):
/// they are carried across, but its mobs are stocked afresh on the far side,
/// and that is worth doing to rescue a tick and not to tidy a number.
Move rebalance(const std::vector<BiomeLoad>& biomes, const std::vector<ServerLoad>& servers);

/// Two thirds of a 30 Hz tick: past this a server is running out of room.
inline constexpr double kOverloadedTickMillis = 22.0;
/// The least cost a move has to take off the busiest server, against what it
/// carries, for the move to be worth making.
inline constexpr double kWorthwhileShare = 0.15;

} // namespace flix::cluster
