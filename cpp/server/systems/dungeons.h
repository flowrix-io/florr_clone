#pragma once
// Dungeons: the nests a flower walks INTO.
//
// A mob whose config carries a `dungeon` (the termite mound) is a door. A
// flower that stands on it for a moment is carried into a private copy of the
// dungeon's map -- one of the realms a `copies` entry in maps.json loads that
// file into -- and the first flower in fills it with the nest's brood. Every
// flower that walks into the same nest afterwards joins that same copy; two
// nests are two copies, and nobody from one ever sees the other.
//
// The nest itself cannot be hurt (it is Intangible). Its dungeon stands in for
// its health: a swing on anything in there is credited to the nest's ledger
// too (combat's creditSwing), and on the tick the last thing in the dungeon
// dies the nest falls where it stands in the overworld -- loot, XP, gallery
// and all, to the players whose swings fill its ledger. Everyone inside is
// carried back out beside it a few seconds later, which is long enough to
// collect what the last of the brood dropped.
//
// The colony: a dungeon's `colony` mobs share every hit. combat's applyDamage
// splits a hit on one of them over all of them; this system keeps the list it
// splits over (DungeonEntrance::colony).
//
// A copy nobody is in for a minute is cleaned out and given back, and its nest
// goes back to being an ordinary unclaimed one -- the next flower to walk in
// finds a fresh brood.

#include <array>
#include <functional>
#include <string>
#include <vector>

#include "shared/core/types.h"
#include "shared/core/world.h"
#include "shared/game/config.h"
#include "shared/game/map_elements.h"
#include "shared/game/realm.h"
#include "shared/game/terrain.h"

namespace flix {

class CombatSystem;
class SpawnSystem;

/// How long a flower stands on a nest before it is taken in. Long enough that
/// walking across one is not a trip inside.
inline constexpr double kDungeonEnterDwellMillis = 600.0;
/// How long a cleared dungeon keeps its party before carrying them back out:
/// time to pick up what the last of the brood dropped.
inline constexpr double kDungeonClearedLingerMillis = 5000.0;
/// How long a copy may stand empty before it is cleaned out and given back.
inline constexpr double kDungeonAbandonMillis = 60000.0;
/// How far outside its nest's rim a flower coming out is put down.
inline constexpr double kDungeonExitGap = 80.0;

class DungeonSystem {
public:
    /// The staged maps. Null leaves the system idle: no copies to claim.
    const WorldMaps* worldMaps = nullptr;
    /// Carries a player into another realm -- GameServer::moveEntityToRealm.
    std::function<void(Entity, Realm, Vec2)> moveToRealm;
    /// Whether this flower may be taken in at all. Bots may not: their
    /// controller only knows the overworld.
    std::function<bool(Entity)> admits;

    void run(World& world, const Terrain& terrain, const ContentRegistry& content,
             SpawnSystem& spawning, CombatSystem& combat, Rng& rng, double nowMillis,
             CommandBuffer& commands);

    /// True when `realm` is one of the dungeon copies.
    bool isInstance(Realm realm) const;

    /// Where a flower leaving the copy `realm` by its own pad comes out:
    /// beside its nest, rather than wherever the pad's `targetMap` says. False
    /// when `realm` is not a copy somebody's nest has claimed.
    bool exitFor(Realm realm, Rng& rng, double bodyRadius, Realm& outRealm, Vec2& out) const;

    /// What tests and the console want to know about one copy.
    struct InstanceView {
        Realm realm = Realm::Overworld;
        bool live = false;
        Entity entrance = NULL_ENTITY;
        int dwellers = 0;
        int players = 0;
        bool cleared = false;
    };
    std::vector<InstanceView> instances() const;

private:
    struct Instance {
        Realm realm = Realm::Overworld;
        std::string mapId;
        bool live = false;
        Entity entrance = NULL_ENTITY;
        Realm returnRealm = Realm::Overworld;
        Vec2 returnAt;
        double returnRadius = 0;
        double clearedAtMillis = -1;
        double emptySinceMillis = -1;
        int dwellers = 0;
        int players = 0;
    };
    struct Approach {
        Entity player = NULL_ENTITY;
        Entity entrance = NULL_ENTITY;
        double sinceMillis = 0;
    };

    void index(const ContentRegistry& content);
    Instance* claim(const std::string& mapId);
    bool populate(World& world, const Terrain& terrain, const ContentRegistry& content,
                  SpawnSystem& spawning, Rng& rng, double nowMillis, Instance& instance,
                  Entity entrance);
    Vec2 arrivalPoint(const Instance& instance, Rng& rng, const Terrain& terrain) const;
    Vec2 exitPoint(const Instance& instance, Rng& rng, double bodyRadius) const;
    void evict(World& world, Instance& instance, Rng& rng);
    void release(World& world, Instance& instance, CommandBuffer& commands);

    bool indexed_ = false;
    std::vector<Instance> instances_;
    /// Realm -> index into instances_, or -1.
    std::array<int, kMaxRealms> byRealm_{};
    std::vector<Approach> approaches_;
};

} // namespace flix
