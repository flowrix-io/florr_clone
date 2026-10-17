// The sacrifice petal: florr's "On death, summons a mob to fight again. Mob
// type depends on where the sacrifice happens. Cannot be used in low mob
// rarity areas."
//
// Two halves, both here:
//
//   * WHERE IT COMES FROM. Nothing drops it and nobody sells it. One Apex
//     Sacrifice is put down on Hel's ground at a time, on a clock dealt
//     uniformly from nothing to a day, without a word in chat. First human
//     to walk over it keeps it; bots leave it alone.
//   * WHAT IT DOES. A flower that dies with one on its active bar spends it:
//     a mob of the band it fell in comes out where it fell, at the petal's
//     tier (SpawnSystem::summonSacrifice), over florr's summoning circle
//     (net::EventKind::Summon). Ground below epic turns it away
//     (groundTakesSacrifice), and then the petal stays on the bar.

#include "server/game_server.h"

#include <algorithm>
#include <cmath>
#include <cstdio>
#include <string>

#include "server/systems/combat.h"
#include "server/systems/loot.h"
#include "server/systems/petals.h"
#include "server/systems/spawning.h"
#include "server/text.h"
#include "shared/game/config.h"
#include "shared/game/rarity.h"

namespace flix {

namespace {

/// The longest wait between two of Hel's sacrifices. Each wait is dealt
/// uniformly between zero and this.
constexpr double kSacrificeSpawnMaxGapMillis = 24.0 * 60.0 * 60.0 * 1000.0;

/// The map the sacrifice appears on, by id, and the tier it appears at.
constexpr const char* kSacrificeMapId = "hel";
constexpr Rarity kSacrificeSpawnRarity = Rarity::Apex;

/// How long one lies on the ground: until somebody takes it. A drop's own
/// lifetime is minutes at most, and Hel is a big place to search.
constexpr double kSacrificeDropLifetimeSeconds = 1e12;

/// The database table the clock is kept in, on the wall clock.
constexpr const char* kSacrificeTable = "sacrificeSpawn";

} // namespace

void GameServer::serviceSacrificeSpawn(double nowMillis) {
    const std::uint16_t petal = content().petalIndex(kSacrificePetalId);
    if (petal == kInvalidIndex) return;
    bool found = false;
    worldMaps_.realmOfId(kSacrificeMapId, found);
    if (!found) return;

    // The wall clock is the only one two runs share; this run's clock is
    // whatever tick() is handed.
    const double toWall = static_cast<double>(database_.nowMillis()) - nowMillis;
    if (sacrificeReadyMillis_ < 0.0) {
        const Json& stored = database_.storedTable(kSacrificeTable);
        if (stored.isObject() && stored["readyAt"].isNumber()) {
            // One elapsed while the server was down comes back due now; one
            // further out than a whole gap can only be a wall clock set back
            // since, and is pulled in.
            sacrificeReadyMillis_ = std::min(stored["readyAt"].asDouble() - toWall,
                                             nowMillis + kSacrificeSpawnMaxGapMillis);
            savedSacrificeReadyMillis_ = sacrificeReadyMillis_;
        } else {
            sacrificeReadyMillis_ = nowMillis + sacrificeRng_.unit() * kSacrificeSpawnMaxGapMillis;
        }
    }

    if (nowMillis >= sacrificeReadyMillis_) {
        // One on the ground at a time. The last one still lying there is the
        // server's sacrifice for this turn too; the clock just deals again.
        if (!sacrificeLying()) placeSacrifice();
        sacrificeReadyMillis_ = nowMillis + sacrificeRng_.unit() * kSacrificeSpawnMaxGapMillis;
    }

    if (sacrificeReadyMillis_ != savedSacrificeReadyMillis_) {
        savedSacrificeReadyMillis_ = sacrificeReadyMillis_;
        Json entry = Json::object();
        entry["readyAt"] = std::round(sacrificeReadyMillis_ + toWall);
        database_.rawTable(kSacrificeTable) = std::move(entry);
        database_.markDirty();
    }
}

bool GameServer::sacrificeLying() const {
    return sacrificeDrop_ != NULL_ENTITY && world_.isAlive(sacrificeDrop_) &&
           world_.has<DropItem>(sacrificeDrop_);
}

std::string GameServer::sacrificeMapLabel(Realm hel) const {
    const MapData* map = worldMaps_.forRealm(hel);
    return map != nullptr && !map->displayName().empty() ? map->displayName() : "Hel";
}

Entity GameServer::placeSacrifice() {
    const std::uint16_t petal = content().petalIndex(kSacrificePetalId);
    if (petal == kInvalidIndex) return NULL_ENTITY;
    bool found = false;
    const Realm hel = worldMaps_.realmOfId(kSacrificeMapId, found);
    if (!found) return NULL_ENTITY;
    Vec2 at;
    if (!spawning_->randomBandPoint(*terrain_, hel, sacrificeRng_, at)) return NULL_ENTITY;
    sacrificeDrop_ = loot_->spawnDrop(world_, petal, kSacrificeSpawnRarity, at, hel, {});
    if (sacrificeDrop_ == NULL_ENTITY) return NULL_ENTITY;

    DropItem& item = world_.get<DropItem>(sacrificeDrop_);
    item.singleCopy = true;
    item.humansOnly = true;
    world_.get<Lifetime>(sacrificeDrop_).remainingSeconds = kSacrificeDropLifetimeSeconds;

    // Laid silently: only the server log says it is there.
    std::printf("[SACRIFICE] placed in %s at (%.0f, %.0f)\n", sacrificeMapLabel(hel).c_str(),
                at.x, at.y);
    return sacrificeDrop_;
}

std::string GameServer::adminPlaceSacrifice() {
    // Hel's own placement, run now instead of when its clock says, and the
    // clock left alone. Still one on the ground at a time: a test that wants
    // a second has to pick the first one up.
    bool found = false;
    const Realm hel = worldMaps_.realmOfId(kSacrificeMapId, found);
    if (!found || content().petalIndex(kSacrificePetalId) == kInvalidIndex) {
        return "There is no Hel map or no sacrifice petal staged.";
    }
    const bool lying = sacrificeLying();
    const Entity drop = lying ? sacrificeDrop_ : placeSacrifice();
    if (drop == NULL_ENTITY) return "Found nowhere in " + sacrificeMapLabel(hel) + " to lay it.";
    const Vec2 at = world_.get<Transform>(drop).position;
    char coordinates[64];
    std::snprintf(coordinates, sizeof coordinates, "(%.0f, %.0f)", at.x, at.y);
    return std::string(lying ? "One is already lying in " : "Placed one in ") +
           sacrificeMapLabel(hel) + " at " + coordinates + ".";
}

void GameServer::offerSacrifice(Session& session, Entity corpse) {
    // The ring's run is a scratch record with its own bar, and the ring is
    // no band anyway.
    if (session.arena || session.userId.empty()) return;
    const std::uint16_t petal = content().petalIndex(kSacrificePetalId);
    if (petal == kInvalidIndex) return;
    const Loadout* loadout = world_.tryGet<Loadout>(corpse);
    const Transform* transform = world_.tryGet<Transform>(corpse);
    if (loadout == nullptr || transform == nullptr) return;

    // The best one on the ACTIVE bar, the leftmost of equals. The petal
    // itself, not a mimic copying it: a mimic is spent on nothing.
    int slot = -1;
    Rarity tier = Rarity::Common;
    for (int i = 0; i < kLoadoutActiveSlots; ++i) {
        const LoadoutSlot& at = loadout->slots[static_cast<std::size_t>(i)];
        if (at.configIndex != petal) continue;
        if (slot < 0 || rarityIndex(at.rarity) > rarityIndex(tier)) {
            slot = i;
            tier = at.rarity;
        }
    }
    if (slot < 0) return;

    // The account's bar is what is spent, so it has to agree with the body's.
    PlayerRecord& record = database_.progress(session.userId);
    const std::size_t index = static_cast<std::size_t>(slot);
    if (index >= record.loadout.size() || !record.loadout[index].has_value() ||
        record.loadout[index]->petalType != kSacrificePetalId ||
        record.loadout[index]->rarity != tier) {
        return;
    }

    const Vec2 position = transform->position;
    const Realm realm = transform->realm;
    SpawnSystem::Sacrifice plan =
        spawning_->planSacrifice(world_, content(), tier, position, realm, rng_);
    // A ritual still drawing its pentagram is that tier's boss already, as
    // far as a second sacrifice in the same map is concerned: two would both
    // summon, and the later would be culled as the biome's second.
    if (plan.outcome == SpawnSystem::SacrificeOutcome::Summoned &&
        (plan.rarity == Rarity::Unique || plan.rarity == Rarity::Apex)) {
        Query<SacrificeRitual, Transform> rituals{world_};
        rituals.each([&](Entity, SacrificeRitual& ritual, Transform& at) {
            if (ritual.mob == NULL_ENTITY && ritual.rarity == plan.rarity && at.realm == realm) {
                plan.outcome = SpawnSystem::SacrificeOutcome::Taken;
            }
        });
    }

    net::Connection* connection = listener_.find(session.connection);
    const std::string petalName = std::string(rarityLabel(tier)) + " " + content().petal(petal).name;
    if (plan.outcome != SpawnSystem::SacrificeOutcome::Summoned) {
        if (connection == nullptr) return;
        std::string why;
        switch (plan.outcome) {
            case SpawnSystem::SacrificeOutcome::LowGround:
                why = "Your " + petalName + " cannot be used in low mob rarity areas.";
                break;
            case SpawnSystem::SacrificeOutcome::Prestige:
                why = "Your " + petalName +
                      " went unanswered: no Unique or Apex can stand in a Prestige biome.";
                break;
            case SpawnSystem::SacrificeOutcome::Taken:
                why = "Your " + petalName + " went unanswered: an " +
                      rarityLabel(ladderRarity(tier)) + " already roams this biome.";
                break;
            default:
                why = "Your " + petalName + " went unanswered: nothing lives here.";
                break;
        }
        sendNotice(*connection, net::NoticeSeverity::Warning, why);
        return;
    }

    // Spent now, at the death: the ritual is already under way.
    record.loadout[index].reset();
    database_.markDirty();
    applyAccountToSession(session);
    // The biome's clock is spent from the moment the ritual begins, so a wild
    // boss of the same tier cannot step in while the pentagram is drawn.
    spawning_->chargeBossClock(plan.rarity, realm, clockMillis_);

    // The ritual: drawn by every client in view, answered by the server once
    // the pentagram is complete (serviceSacrificeRituals).
    SacrificeRitual ritual;
    ritual.mobIndex = plan.mobIndex;
    ritual.rarity = plan.rarity;
    ritual.summonAtMillis = clockMillis_ + kSacrificeRitualMillis;
    ritual.radius = content().mobStats(plan.mobIndex, plan.rarity).radius *
                    kSacrificeRitualRadiusScale;
    ritual.ownerConnection = session.connection;
    const Entity e = world_.create();
    // Each ritual turned its own way: the star's points fall where they fall.
    world_.add<Transform>(e, Transform{position, sacrificeRng_.angle(), realm});
    world_.add<SacrificeRitual>(e, ritual);
    Replicated replicated;
    replicated.kind = net::EntityKind::Effect;
    replicated.typeIndex = static_cast<std::uint16_t>(GroundEffectKind::Sacrifice);
    replicated.rarity = plan.rarity;
    world_.add<Replicated>(e, replicated);
    world_.add<NetId>(e, NetId{netIds_.next()});

    std::printf("[SACRIFICE] %s spent a %s\n", session.username.c_str(), petalName.c_str());
    if (connection != nullptr) sendProfile(session, *connection);
}

void GameServer::announceSacrificeSummon(Entity mob, Realm realm) {
    const MobType& type = world_.get<MobType>(mob);
    const std::string& name = content().mob(type.configIndex).name;
    char colorAttribute[32];
    std::snprintf(colorAttribute, sizeof colorAttribute, "#%06x", rarityColor(type.rarity));
    const std::string biome = biomeOfRealm(realm);
    // Worded per recipient, as a boss spawn is: a player in the summon's own
    // biome is told it was summoned, everyone else that it was summoned
    // "somewhere".
    for (auto& entry : sessions_) {
        Session& session = entry.second;
        if (!session.playing()) continue;
        net::Connection* connection = listener_.find(session.connection);
        if (connection == nullptr) continue;
        const bool here = !biome.empty() && biomeOfEntity(session.entity) == biome;
        sendChatTo(*connection, net::ChatChannel::System, "",
                   std::string("<b style=\"color: ") + colorAttribute + ";\">A " +
                       rarityLabel(type.rarity) + " " + name + " has been summoned" +
                       (here ? "" : " somewhere") + "!</b>");
    }
}

void GameServer::markSacrificed(Entity mob) {
    if (Replicated* replicated = world_.tryGet<Replicated>(mob)) {
        replicated->spawnFlags |= net::SpawnSacrificed;
    }
    Query<BodySegment, Replicated> segments{world_};
    segments.each([&](Entity, BodySegment& link, Replicated& replicated) {
        if (link.chainHead == mob) replicated.spawnFlags |= net::SpawnSacrificed;
    });
    Query<MobRingPetal, Replicated> seeds{world_};
    seeds.each([&](Entity, MobRingPetal& seed, Replicated& replicated) {
        if (seed.mob == mob) replicated.spawnFlags |= net::SpawnSacrificed;
    });
}

void GameServer::sweepSacrificeStars(const std::vector<Entity>& rituals, double nowMillis) {
    if (rituals.empty()) return;
    const auto inStar = [&](const Transform& at) {
        for (const Entity e : rituals) {
            const Transform& star = world_.get<Transform>(e);
            if (star.realm == at.realm &&
                insideSacrificeStar(star.position, star.angle,
                                    world_.get<SacrificeRitual>(e).radius, at.position)) {
                return true;
            }
        }
        return false;
    };

    // Summons first: killed where they stand, and the egg that hatched each
    // goes back on its reload. Collected before anything is touched, because
    // reloading a slot destroys the petals on it.
    std::vector<Entity> pets;
    Query<Pet, Transform> summons{world_};
    summons.without<Dead>();
    summons.each([&](Entity pet, Pet&, Transform& at) {
        if (inStar(at)) pets.push_back(pet);
    });
    for (const Entity pet : pets) {
        petals_->reloadHatcher(world_, content(), pet, nowMillis);
        combat_->fell(world_, pet, NULL_ENTITY);
    }

    // Then the eggs themselves: a summoning petal on a ring that reaches into
    // the star is put on its reload. Its pets standing outside stay out.
    struct Egg {
        Entity owner;
        std::uint8_t slot;
    };
    std::vector<Egg> eggs;
    Query<PetalInstance, Transform> petals{world_};
    petals.without<Dead>();
    petals.each([&](Entity, PetalInstance& instance, Transform& at) {
        if (content().petal(instance.configIndex).petMobIndex == kInvalidIndex) return;
        if (inStar(at)) eggs.push_back({instance.owner, instance.slot});
    });
    for (const Egg& egg : eggs) {
        // A second grain of the same slot finds it already reloading.
        petals_->spendSlot(world_, content(), egg.owner, egg.slot, nowMillis, false);
    }
}

void GameServer::serviceSacrificeRituals(double nowMillis) {
    Query<SacrificeRitual, Transform> rituals{world_};
    std::vector<Entity> list;
    rituals.collect(list);
    sweepSacrificeStars(list, nowMillis);
    for (const Entity e : list) {
        SacrificeRitual& ritual = world_.get<SacrificeRitual>(e);
        if (ritual.mob == NULL_ENTITY) {
            if (nowMillis < ritual.summonAtMillis) continue;
            // The pentagram is complete: the mob comes out at its centre.
            const Transform at = world_.get<Transform>(e);
            SpawnSystem::Sacrifice plan;
            plan.outcome = SpawnSystem::SacrificeOutcome::Summoned;
            plan.mobIndex = ritual.mobIndex;
            plan.rarity = ritual.rarity;
            const std::uint32_t owner = ritual.ownerConnection;
            const Entity mob = spawning_->spawnSacrifice(world_, *terrain_, content(), plan,
                                                         at.position, at.realm, nowMillis, rng_);
            // Re-fetched: the spawn created entities, which can move this row.
            if (mob == NULL_ENTITY) {
                commands_.destroy(e);
                continue;
            }
            // The summoned animal keeps its colour under its own star: the
            // mob, every segment of its body and every seed on its ring.
            markSacrificed(mob);
            SacrificeRitual& placed = world_.get<SacrificeRitual>(e);
            placed.mob = mob;
            if (const Body* body = world_.tryGet<Body>(mob)) {
                placed.radius = body->radius * kSacrificeRitualRadiusScale;
            }
            announceSacrificeSummon(mob, at.realm);
            if (Session* session = sessionFor(owner)) {
                if (net::Connection* connection = listener_.find(session->connection)) {
                    const MobType& type = world_.get<MobType>(mob);
                    const char* label = rarityLabel(type.rarity);
                    sendNotice(*connection, net::NoticeSeverity::Info,
                               std::string("Your sacrifice summoned ") +
                                   (std::string("AEIOU").find(label[0]) != std::string::npos
                                        ? "an "
                                        : "a ") +
                                   label + " " +
                                   content().mob(type.configIndex).name + ".");
                }
            }
            continue;
        }
        // The star and the pentagram stand until the mob they brought is dead.
        if (!world_.isAlive(ritual.mob) || world_.has<Dead>(ritual.mob)) commands_.destroy(e);
    }
}

} // namespace flix
