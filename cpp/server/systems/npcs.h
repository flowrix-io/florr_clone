#pragma once
// NPCs: putting them where the maps say, keeping them there, and deciding who
// each one is looking at.
//
// What an NPC IS lives in shared/game/npc.h. This system owns the four things
// that happen to one in the world:
//
//   PLACING   every map's `npcs` layer is read once into a list of SITES, and a
//             site whose NPC is missing gets a fresh one on the next tick --
//             at start-up, and after anything (an operator, a test) destroyed
//             the last one. There is no death to wait out: nothing an NPC is
//             hit by takes anything off it, so a missing one is a hole in the
//             map, not a casualty.
//   MOVING    an NPC whose mob flies like a bee (`bee_ai`) cruises about its
//             home on the bee's own cruise (stepBeeCruise), on a leash that
//             turns it back once it is kNpcLeashRadius out -- the oracle stays
//             where the map says it is, give or take a flight. Any other NPC
//             stands still.
//   LOOKING   an NPC that cruises looks where it is going, always. One that
//             stands turns to face the nearest flower in its realm inside
//             kNpcWatchRange, and glances about when there is none. That
//             facing is all the client needs to move its eye.
//   FINDING   the server's half of a service: "is this flower standing close
//             enough to an oracle, a trader or the titan to be using it".
//             Answered from the NPCs in the world rather than from the sites,
//             so an admin's extra one counts and a site whose NPC is gone
//             does not.
//
// An NPC has no Motion and no AI, so nothing in the movement or intent phases
// moves it; this system moves it and writes its facing directly, once a tick.
// Flowers and loose petals are the things that collide with it, and that is
// the movement system's business (MovementSystem::pushOutOfNpcs,
// collideLooseBodies).

#include <cstdint>
#include <optional>
#include <string>
#include <vector>

#include "server/replication.h"
#include "shared/core/types.h"
#include "shared/core/world.h"
#include "shared/game/components.h"
#include "shared/game/config.h"
#include "shared/game/map_elements.h"
#include "shared/game/realm.h"
#include "shared/game/terrain.h"

namespace flix {

/// How far from its home a cruising NPC may drift before it turns back, from
/// its centre, and how much of the way to home its heading turns each tick
/// once it is out there -- a curve back, with the weave still on it, rather
/// than an about-face.
inline constexpr double kNpcLeashRadius = 260.0;
inline constexpr double kNpcLeashTurn = 0.08;

class NpcSystem {
public:
    /// Where replicated ids come from. Left null, NPCs are still placed and
    /// still answer findService() -- they are simply never sent, which is what
    /// a headless test wants and what production must not be.
    NetIdAllocator* netIds = nullptr;

    /// One NPC the maps asked for.
    struct Site {
        Realm realm = Realm::Overworld;
        Vec2 position;
        std::uint16_t mobIndex = 0;
        Rarity rarity = Rarity::Common;
        /// The NPC standing on it now, or NULL_ENTITY until the first run().
        Entity entity = NULL_ENTITY;
    };

    /// Reads every map's `npcs` layer into sites. Called once the maps and the
    /// content are both loaded. A site naming a mob the content does not have,
    /// or a mob with no `npc` block, is dropped and said out loud in
    /// `warnings`: a map that asks for an oracle and silently gets nothing is
    /// a map nobody can debug.
    void loadSites(const WorldMaps& maps, const ContentRegistry& content,
                   std::vector<std::string>& warnings);

    /// Seeds the stream the idle glances are rolled from.
    ///
    /// Their OWN stream, never the world's: a glance is decoration, and one
    /// drawn from the world's rolls would move every spawn and drop after it
    /// -- the reason the bots have a stream of their own too.
    void seed(std::uint64_t seed) { rng_.reseed(seed); }

    /// Places every site that is missing its NPC. The server calls this once
    /// at boot, so a map's NPCs are standing before anybody arrives -- the
    /// first snapshot a player is sent already carries them -- and run() calls
    /// it every tick after, which is what puts back one that was removed.
    void placeMissing(World& world, const Terrain& terrain, const ContentRegistry& content,
                      double nowMillis);

    /// placeMissing(), then turns every NPC toward the nearest flower in
    /// `players` (or lets it glance about).
    void run(World& world, const Terrain& terrain, const ContentRegistry& content,
             const std::vector<RealmPoint>& players, double nowMillis);

    /// Puts one NPC into the world: the mob `mobIndex` at `rarity`, standing
    /// at `at` (moved only if its centre is inside a wall -- an NPC meets
    /// walls as a point, kMobWallRadius, as a mob does), on the side
    /// its mob's `npc` block names -- or on `side`, when the caller gives one.
    /// The one path an NPC comes from -- a site, and the admin console's
    /// `spawn_npc`, both go through here. Any mob will do: one with no `npc`
    /// block stands as an empty block would have it, on the players' side
    /// offering nothing. NULL_ENTITY for a mob index the content does not
    /// have.
    Entity spawnNpc(World& world, const Terrain& terrain, const ContentRegistry& content,
                    std::uint16_t mobIndex, Rarity rarity, Vec2 at, Realm realm,
                    double nowMillis, std::optional<Team> side = std::nullopt);

    /// The nearest NPC offering `service` whose SKIN is within `reach` of
    /// `at`, in `realm`; NULL_ENTITY when there is none. The reach is measured
    /// from the NPC's edge because that is what a player walks up to.
    Entity findService(World& world, NpcService service, Vec2 at, Realm realm, double reach);

    const std::vector<Site>& sites() const { return sites_; }

private:
    void bind(World& world);

    std::vector<Site> sites_;
    /// Glances, and the cruises' re-picked headings: the NPCs' own stream.
    Rng rng_{0x0DAC1E5EED5ull};
    World* boundWorld_ = nullptr;
    std::optional<Query<NpcTag, Npc, Transform>> npcs_;
};

} // namespace flix
