#include "server/systems/spawning.h"

#include <algorithm>
#include <cmath>

namespace flr {

// ---------------------------------------------------------------------------
// Binding
// ---------------------------------------------------------------------------

void SpawnSystem::bind(World& world) {
    if (boundWorld_ == &world) return;
    boundWorld_ = &world;
    // Queries cache their matched archetypes and are meant to outlive a tick,
    // but they need a world to be constructed against and this system is built
    // before the server has one. Rebinding also covers a test that runs the
    // same system over a second world.
    ambient_.emplace(world);
    ambient_->without<Dead>();
    escorts_.emplace(world);
    escorts_->without<Dead>();
    spawners_.emplace(world);
    spawners_->without<Dead>();
    waveNests_.emplace(world);
    waveNests_->without<Dead>();
}

// ---------------------------------------------------------------------------
// Type and tier selection
// ---------------------------------------------------------------------------

void SpawnSystem::rebuildCandidates(const ContentRegistry& content) {
    if (candidateContent_ == &content && candidateHash_ == content.contentHash()) return;
    candidateContent_ = &content;
    candidateHash_ = content.contentHash();

    for (SectionCandidates& section : candidates_) {
        section.mobs.clear();
        section.cumulative.clear();
    }

    for (std::size_t i = 0; i < content.mobCount(); ++i) {
        const std::uint16_t index = static_cast<std::uint16_t>(i);
        const MobConfig& config = content.mob(index);
        // A zero weight is how the data says "reachable only by other means":
        // centipede body segments belong to a section but are never rolled.
        if (!(config.spawnWeight > 0.0) || config.sectionMask == 0) continue;
        for (int s = 0; s < kSectionCount; ++s) {
            if ((config.sectionMask & (1u << s)) == 0) continue;
            SectionCandidates& section = candidates_[static_cast<std::size_t>(s)];
            const double running = section.cumulative.empty() ? 0.0 : section.cumulative.back();
            section.mobs.push_back(index);
            section.cumulative.push_back(running + config.spawnWeight);
        }
    }
}

std::uint16_t SpawnSystem::chooseMobType(const ContentRegistry& content, int section, Rng& rng) {
    rebuildCandidates(content);
    if (section < 0 || section >= kSectionCount) return kInvalidIndex;

    const SectionCandidates& candidates = candidates_[static_cast<std::size_t>(section)];
    if (candidates.mobs.empty()) return kInvalidIndex;

    const double roll = rng.unit() * candidates.cumulative.back();
    const auto it = std::upper_bound(candidates.cumulative.begin(), candidates.cumulative.end(), roll);
    // unit() is strictly below 1, so the search only falls off the end through
    // floating-point slop on the running total; the last entry is the answer.
    const std::size_t slot = it == candidates.cumulative.end()
                                 ? candidates.mobs.size() - 1
                                 : static_cast<std::size_t>(it - candidates.cumulative.begin());
    return candidates.mobs[slot];
}

Rarity SpawnSystem::rollRarity(const MobConfig& config, Rng& rng) {
    double total = 0.0;
    for (const double weight : kNaturalSpawnWeight) total += weight;

    int tier = 0;
    if (total > 0.0) {
        double roll = rng.unit() * total;
        for (int i = 0; i < kRarityCount; ++i) {
            if (kNaturalSpawnWeight[static_cast<std::size_t>(i)] <= 0.0) continue;
            // Tracked as we go rather than after the loop, so a roll that never
            // goes negative lands on the last WEIGHTED tier -- never on ultra
            // and above, which carry no natural weight at all.
            tier = i;
            roll -= kNaturalSpawnWeight[static_cast<std::size_t>(i)];
            if (roll < 0.0) break;
        }
    }
    return clampRarity(std::max(tier, rarityIndex(config.minRarity)));
}

// ---------------------------------------------------------------------------
// Placing a mob
// ---------------------------------------------------------------------------

Entity SpawnSystem::spawnMob(World& world, const Terrain& terrain, const ContentRegistry& content,
                             std::uint16_t mobIndex, Rarity rarity, Vec2 position,
                             double nowMillis, Rng& rng) {
    return spawnMobAt(world, terrain, content, mobIndex, rarity, position, nowMillis, rng, 0);
}

Entity SpawnSystem::spawnMobAt(World& world, const Terrain& terrain, const ContentRegistry& content,
                               std::uint16_t mobIndex, Rarity rarity, Vec2 position,
                               double nowMillis, Rng& rng, int depth) {
    if (mobIndex >= content.mobCount()) return NULL_ENTITY;

    const MobConfig& config = content.mob(mobIndex);
    // A mob does not exist below its min_rarity, whoever asked for it. Enforced
    // here rather than at each call site so a nest, a script and the ambient
    // roll cannot disagree about it.
    rarity = clampRarity(std::max(rarityIndex(rarity), rarityIndex(config.minRarity)));
    const MobStats stats = content.mobStats(mobIndex, rarity);

    const double jitter = config.randomSizeMax > config.randomSizeMin
                              ? rng.range(config.randomSizeMin, config.randomSizeMax)
                              : config.randomSizeMin;
    const double radius = stats.radius * jitter;

    // resolveCircle, not a blocked() test: the caller hands over a point and
    // the mob is a body, so a spot one unit from a wall is legal as a point and
    // embedded as a circle.
    const Vec2 at = terrain.resolveCircle(position, radius);

    const Entity e = world.create();
    world.add<MobTag>(e);
    world.add<Transform>(e, Transform{at, rng.angle()});
    world.add<Motion>(e);
    // Mass is area, and the jitter is a diameter multiplier, so it squares.
    world.add<Body>(e, Body{radius, stats.mass * jitter * jitter});
    world.add<Knockback>(e);
    world.add<Faction>(e, Faction{Team::Hostiles, false});
    world.add<Health>(e, Health{stats.health, stats.health, 0.0, 0.0});
    // The config's cooldown is the gap between deliberate ATTACKS, which the AI
    // owns; touching a mob is throttled by the same rule for every mob.
    world.add<ContactDamage>(e, ContactDamage{stats.damage, kMobHitIntervalMillis});
    world.add<HitCooldowns>(e);
    world.add<Afflictions>(e);
    world.add<MobType>(e, MobType{mobIndex, rarity, jitter});

    Bounty bounty;
    bounty.xp = stats.xp;
    world.add<Bounty>(e, std::move(bounty));

    MobAi ai;
    ai.kind = config.ai;
    ai.anchor = at;
    ai.aggroRange = stats.aggroRange;
    ai.wanderAngle = rng.angle();
    ai.nextDecisionMillis = nowMillis;
    world.add<MobAi>(e, std::move(ai));

    world.add<AmbientMob>(e, AmbientMob{nowMillis});
    world.add<Replicated>(e, Replicated{net::EntityKind::Mob, 0, mobIndex, rarity, 0});
    if (netIds != nullptr) world.add<NetId>(e, NetId{netIds->next()});

    ++census_.mobs;
    ++census_.spawnedTotal;
    const int section = sectionAt(at);
    if (section >= 0) ++census_.perSection[static_cast<std::size_t>(section)];

    if (depth < kMaxNestDepth) {
        if (config.periodicSpawn.present) {
            Spawner spawner;
            spawner.childConfigIndex = config.periodicSpawn.mobIndex;
            spawner.rarityOffset = config.periodicSpawn.rarityOffset;
            spawner.intervalMillis = config.periodicSpawn.intervalMillis;
            spawner.nextSpawnMillis = nowMillis + config.periodicSpawn.intervalMillis;
            spawner.childLifetimeMillis = config.periodicSpawn.lifetimeMillis;
            spawner.maxAlive = config.periodicSpawn.maxAlive;
            world.add<Spawner>(e, std::move(spawner));
        }
        if (!config.spawnWaves.empty()) {
            NestWaves waves;
            waves.mobIndex = mobIndex;
            waves.nextWaveMillis = nowMillis + kNestWaveIntervalMillis;
            world.add<NestWaves>(e, std::move(waves));
        }
        // Last, because every escort is a create() that can relocate the rows
        // the adds above were writing into. Nothing may touch `e` after this.
        for (const std::uint16_t child : config.initialSpawns) {
            spawnEscort(world, terrain, content, child, rarity, at, radius, nowMillis, rng, depth + 1);
        }
    }

    return e;
}

Entity SpawnSystem::spawnEscort(World& world, const Terrain& terrain, const ContentRegistry& content,
                                std::uint16_t childIndex, Rarity nestRarity, Vec2 anchor,
                                double anchorRadius, double nowMillis, Rng& rng, int depth) {
    if (census_.mobs >= kMaxLiveMobs) return NULL_ENTITY;
    const double ring = anchorRadius + rng.range(40.0, 140.0);
    const Vec2 at = anchor + Vec2::fromAngle(rng.angle(), ring);
    return spawnMobAt(world, terrain, content, childIndex, nestRarity, at, nowMillis, rng, depth);
}

// ---------------------------------------------------------------------------
// The tick
// ---------------------------------------------------------------------------

void SpawnSystem::run(World& world, const Terrain& terrain, const ContentRegistry& content,
                      const std::vector<Vec2>& players, Rng& rng, double nowMillis, double dt,
                      CommandBuffer& commands) {
    bind(world);
    rebuildCandidates(content);

    expireEscorts(dt, commands);
    runNests(world, terrain, content, rng, nowMillis);

    // The census is O(mobs x players) and nothing about a population of a few
    // hundred changes meaningfully inside 200ms.
    if (nowMillis < nextPopulationMillis_) return;
    nextPopulationMillis_ = nowMillis + kPopulationIntervalMillis;

    takeCensus(players, nowMillis, commands);
    fillNeighbourhoods(world, terrain, content, players, rng, nowMillis);
}

void SpawnSystem::expireEscorts(double dt, CommandBuffer& commands) {
    doomed_.clear();
    escorts_->each([&](Entity e, AmbientMob&, Lifetime& lifetime) {
        // A zero remainder means "no timer": only nest escorts are given one,
        // and an ambient mob must not evaporate because the field defaulted.
        if (lifetime.remainingSeconds <= 0.0) return;
        lifetime.remainingSeconds -= dt;
        if (lifetime.remainingSeconds <= 0.0) doomed_.push_back(e);
    });
    // Destroyed, not killed: an escort running out of time is bookkeeping, and
    // marking it Dead would pay out XP and loot for a mob nobody fought.
    for (const Entity e : doomed_) commands.destroy(e);
}

void SpawnSystem::takeCensus(const std::vector<Vec2>& players, double nowMillis,
                             CommandBuffer& commands) {
    census_.mobs = 0;
    census_.perSection.fill(0);
    neighbours_.assign(players.size(), 0);
    doomed_.clear();

    const double activeSq = kMobActiveRadius * kMobActiveRadius;
    const double despawnSq = kMobDespawnRadius * kMobDespawnRadius;

    ambient_->each([&](Entity e, MobTag&, Transform& transform, AmbientMob& ambient) {
        bool nearAnyone = false;
        for (std::size_t i = 0; i < players.size(); ++i) {
            const double d2 = distanceSq(players[i], transform.position);
            if (d2 <= activeSq) ++neighbours_[i];
            if (d2 <= despawnSq) nearAnyone = true;
        }

        if (nearAnyone) {
            ambient.lastNearPlayerMillis = nowMillis;
        } else if (nowMillis - ambient.lastNearPlayerMillis >= kMobDespawnDelayMillis) {
            // Left out of the counts on purpose: it is on its way out, and
            // counting it would suppress the replacement spawn for one pass.
            doomed_.push_back(e);
            return;
        }

        ++census_.mobs;
        const int section = sectionAt(transform.position);
        if (section >= 0) ++census_.perSection[static_cast<std::size_t>(section)];
    });

    for (const Entity e : doomed_) commands.destroy(e);
    census_.despawnedTotal += static_cast<int>(doomed_.size());
}

bool SpawnSystem::placementAllowed(const Terrain& terrain, const std::vector<Vec2>& players,
                                   Vec2 position, int& sectionOut) const {
    sectionOut = sectionAt(position);
    if (sectionOut < 0) return false;
    if (terrain.blocked(position)) return false;
    const double minSq = kMinSpawnDistance * kMinSpawnDistance;
    for (const Vec2& player : players) {
        if (distanceSq(player, position) < minSq) return false;
    }
    return true;
}

void SpawnSystem::fillNeighbourhoods(World& world, const Terrain& terrain,
                                     const ContentRegistry& content,
                                     const std::vector<Vec2>& players, Rng& rng, double nowMillis) {
    const double innerSq = kSpawnRingMin * kSpawnRingMin;
    const double outerSq = kSpawnRingMax * kSpawnRingMax;

    for (std::size_t i = 0; i < players.size(); ++i) {
        const int deficit = kMobsPerPlayer - neighbours_[i];
        if (deficit <= 0) continue;

        const int budget = std::min(deficit, kMaxSpawnsPerPass);
        for (int n = 0; n < budget; ++n) {
            if (census_.mobs >= kMaxLiveMobs) return;

            Vec2 at;
            int section = -1;
            bool placed = false;
            for (int attempt = 0; attempt < kSpawnPlacementAttempts; ++attempt) {
                // Sampled by area, so the ring is not several times denser at
                // its inner edge than at its outer one.
                const double r = std::sqrt(lerp(innerSq, outerSq, rng.unit()));
                const Vec2 wanted = players[i] + Vec2::fromAngle(rng.angle(), r);
                const Vec2 candidate = terrain.findOpenSpawn(rng, wanted, kSpawnScatterRadius);
                if (placementAllowed(terrain, players, candidate, section)) {
                    at = candidate;
                    placed = true;
                    break;
                }
            }
            // Every ring sample landed in a wall, a lake or another player's
            // lap. Give up on this player for the pass rather than burning the
            // rest of the budget on the same geometry.
            if (!placed) break;

            const std::size_t bucket = static_cast<std::size_t>(section);
            if (census_.perSection[bucket] >= std::min(kSectionTargetPopulation, kMaxMobsPerSection)) {
                continue;
            }

            const std::uint16_t type = chooseMobType(content, section, rng);
            if (type == kInvalidIndex) break;   // nothing lives in this section

            const Rarity rarity = rollRarity(content.mob(type), rng);
            if (spawnMob(world, terrain, content, type, rarity, at, nowMillis, rng) == NULL_ENTITY) {
                break;
            }
            ++neighbours_[i];
        }
    }
}

void SpawnSystem::runNests(World& world, const Terrain& terrain, const ContentRegistry& content,
                           Rng& rng, double nowMillis) {
    // Both loops snapshot their nests first: spawning an escort creates
    // entities, which relocates the very columns the query would be walking.
    spawners_->collect(scratchChildren_);
    for (const Entity nest : scratchChildren_) {
        Spawner* spawner = world.tryGet<Spawner>(nest);
        const Transform* transform = world.tryGet<Transform>(nest);
        const MobType* type = world.tryGet<MobType>(nest);
        if (spawner == nullptr || transform == nullptr || type == nullptr) continue;

        // Handles rather than a counter: a counter leaks a slot every time a
        // child dies somewhere else, and the nest goes quiet forever.
        std::size_t live = 0;
        for (const Entity child : spawner->children) {
            if (world.isAlive(child)) spawner->children[live++] = child;
        }
        spawner->children.resize(live);

        if (nowMillis < spawner->nextSpawnMillis) continue;
        spawner->nextSpawnMillis = nowMillis + std::max(1.0, spawner->intervalMillis);
        if (static_cast<int>(live) >= spawner->maxAlive) continue;

        // Read everything out before spawning: `spawner` points into an
        // archetype column and does not survive a create().
        const std::uint16_t childIndex = spawner->childConfigIndex;
        const Rarity childRarity = clampRarity(rarityIndex(type->rarity) + spawner->rarityOffset);
        const double lifetimeMillis = spawner->childLifetimeMillis;
        const Vec2 anchor = transform->position;
        const Body* body = world.tryGet<Body>(nest);
        const double anchorRadius = body != nullptr ? body->radius : kMobBaseRadius;

        const Entity child = spawnEscort(world, terrain, content, childIndex, childRarity, anchor,
                                         anchorRadius, nowMillis, rng, 1);
        if (child == NULL_ENTITY) continue;
        if (lifetimeMillis > 0.0) {
            world.add<Lifetime>(child, Lifetime{lifetimeMillis / 1000.0});
        }
        if (Spawner* again = world.tryGet<Spawner>(nest)) again->children.push_back(child);
    }

    waveNests_->collect(scratchChildren_);
    for (const Entity nest : scratchChildren_) {
        NestWaves* waves = world.tryGet<NestWaves>(nest);
        const Transform* transform = world.tryGet<Transform>(nest);
        const MobType* type = world.tryGet<MobType>(nest);
        if (waves == nullptr || transform == nullptr || type == nullptr) continue;

        std::size_t live = 0;
        for (const Entity child : waves->children) {
            if (world.isAlive(child)) waves->children[live++] = child;
        }
        waves->children.resize(live);

        if (nowMillis < waves->nextWaveMillis) continue;
        waves->nextWaveMillis = nowMillis + kNestWaveIntervalMillis;
        if (static_cast<int>(live) >= kMaxNestChildren) continue;

        const MobConfig& config = content.mob(waves->mobIndex);
        if (config.spawnWaves.empty()) continue;

        const std::size_t last = config.spawnWaves.size() - 1;
        const std::size_t index = std::min<std::size_t>(waves->nextWave, last);
        // The final wave repeats. The lists escalate and end on the hardest
        // group, and a nest that falls silent once it runs out is worse than
        // one that holds at its peak.
        waves->nextWave = static_cast<std::uint16_t>(std::min(index + 1, last));

        const Rarity nestRarity = type->rarity;
        const Vec2 anchor = transform->position;
        const Body* body = world.tryGet<Body>(nest);
        const double anchorRadius = body != nullptr ? body->radius : kMobBaseRadius;

        int room = kMaxNestChildren - static_cast<int>(live);
        // The wave list lives in the registry, not in the world, so it is safe
        // to walk while entities are being created.
        for (const std::uint16_t member : config.spawnWaves[index]) {
            if (room <= 0) break;
            const Entity child = spawnEscort(world, terrain, content, member, nestRarity, anchor,
                                             anchorRadius, nowMillis, rng, 1);
            if (child == NULL_ENTITY) break;
            if (NestWaves* again = world.tryGet<NestWaves>(nest)) again->children.push_back(child);
            --room;
        }
    }
}

} // namespace flr
