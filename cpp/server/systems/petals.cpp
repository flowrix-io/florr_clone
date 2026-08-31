#include "server/systems/petals.h"

#include <algorithm>
#include <cmath>

namespace flr {
namespace {

/// Cluster spacing as a multiple of a petal's own radius. Two radii puts the
/// grains shoulder to shoulder: any tighter and a clump reads as one blob.
constexpr double kClumpSpacing = 2.0;

/// A cooldown of zero is a config that forgot to say how long, not a petal that
/// returns the instant it breaks.
double reloadMillisFor(const PetalStats& stats) {
    return stats.reloadMillis > 0.0 ? stats.reloadMillis : kDefaultPetalReloadMillis;
}

/// `range` is a multiple of the ring radius. The JSON leaves it out for every
/// ordinary petal and writes 0 for the ones that sit on the flower -- and those
/// are all noPhysics, which is what placement actually keys off.
double rangeMultiplier(const PetalConfig& config) {
    return config.range > 0.0 ? config.range : 1.0;
}

bool hasTimedAction(const PetalConfig& config, const PetalStats& stats) {
    return config.projectile.present || stats.heal > 0.0 || config.radiation.present ||
           config.webRadius > 0.0 || config.petMobIndex != kInvalidIndex;
}

/// The gap between two of a petal's actions. A petal may declare more than one
/// kind (dahlia both heals and clumps); the slowest wins, so a petal never acts
/// more often than its longest declared gap. The tick floor keeps a config with
/// a one-millisecond cooldown from becoming a per-tick emitter.
double actionIntervalMillis(const PetalConfig& config, const PetalStats& stats) {
    double interval = 0;
    if (config.projectile.present) interval = std::max(interval, stats.reloadMillis);
    if (stats.heal > 0.0) interval = std::max(interval, stats.healChargeMillis);
    if (config.radiation.present) interval = std::max(interval, config.radiation.intervalMillis);
    if (config.webRadius > 0.0) interval = std::max(interval, stats.reloadMillis);
    if (config.petMobIndex != kInvalidIndex) interval = std::max(interval, stats.reloadMillis);
    return std::max(interval, net::kTickMillis);
}

/// A petal the reaper has not got to yet is already gone as far as the ring is
/// concerned, so its remaining health reads as none.
double instanceHealth(World& world, Entity petal) {
    if (world.has<Dead>(petal)) return 0.0;
    const Health* health = world.tryGet<Health>(petal);
    return health ? health->current : 0.0;
}

void healPlayer(World& world, Entity player, double amount) {
    if (amount <= 0.0) return;
    Health* health = world.tryGet<Health>(player);
    // Healing a corpse is a respawn, and that decision is not a petal's.
    if (!health || !health->alive()) return;
    health->current = std::min(health->max, health->current + amount);
}

bool playerIsDown(World& world, Entity player) {
    if (world.has<Dead>(player)) return true;
    const Health* health = world.tryGet<Health>(player);
    return health != nullptr && !health->alive();
}

} // namespace

// ---------------------------------------------------------------------------
// Tick
// ---------------------------------------------------------------------------

void PetalSystem::run(World& world, const ContentRegistry& registry, double nowMillis, double dt,
                      CommandBuffer& commands) {
    bindTo(world);
    // A snapshot of handles, not a live query: everything this system does --
    // spawning a petal, breaking one, firing a volley -- is structural, and
    // none of it may happen while a query holds column pointers. Taking the
    // snapshot first is what makes the direct create/destroy calls below legal,
    // and is why the phase's CommandBuffer goes unused here.
    (void)commands;
    players_->collect(playerList_);

    for (const Entity player : playerList_) {
        if (!world.isAlive(player)) continue;
        if (playerIsDown(world, player)) {
            clearRing(world, player);
            continue;
        }
        reconcileSlots(world, registry, player, nowMillis);
        const Aggregate aggregate = recomputeModifiers(world, registry, player);
        applyPassiveHeal(world, player, aggregate, dt);
        updateRing(world, player, aggregate, dt);
        placePetals(world, registry, player);
        runActions(world, registry, player, nowMillis);
    }
}

void PetalSystem::bindTo(World& world) {
    // A Query caches archetype indices, and those belong to one world. A test
    // that reuses the system across worlds must not inherit the old cache.
    if (bound_ == &world && players_) return;
    bound_ = &world;
    players_ = std::make_unique<Query<PlayerTag, Transform, Loadout, PetalRing>>(world);
}

// ---------------------------------------------------------------------------
// Slots: spawning, breaking, reloading
// ---------------------------------------------------------------------------

void PetalSystem::clearRing(World& world, Entity player) {
    if (Loadout* loadout = world.tryGet<Loadout>(player)) {
        for (const Entity petal : loadout->spawned) {
            if (world.isAlive(petal)) world.destroy(petal);
        }
        loadout->spawned.clear();
        // Death costs the ring, not the reload debt of every slot. Respawning
        // with eight petals still counting down would be a worse bug than a
        // free reset, and death already cost the player everything else.
        for (LoadoutSlot& slot : loadout->slots) {
            slot.broken = false;
            slot.reloadReadyAtMillis = 0;
        }
    }
    if (PetalSlotState* state = world.tryGet<PetalSlotState>(player)) {
        for (PetalSlotState::Slot& slot : state->slots) {
            recallPets(world, slot);
            slot = PetalSlotState::Slot{};   // kNoPetal forces a rebuild on respawn
        }
    }
}

void PetalSystem::reconcileSlots(World& world, const ContentRegistry& registry, Entity player,
                                 double nowMillis) {
    if (!world.has<Loadout>(player)) return;
    // ensure() can relocate the player, so it happens before any pointer into
    // its columns is taken. After this line nothing moves the player between
    // archetypes: a petal carries PetalTag and a player carries PlayerTag, so
    // no petal can ever land in the player's archetype and spawning or
    // destroying one cannot touch the columns held below.
    PetalSlotState& state = world.ensure<PetalSlotState>(player);
    Loadout& loadout = world.get<Loadout>(player);

    // Bucket the live petals by slot, dropping the handles the world has
    // already reaped and the ones combat killed this tick. Both count as
    // instances lost, which the health fold below charges to the pool.
    for (auto& bucket : bySlot_) bucket.clear();
    std::size_t kept = 0;
    for (const Entity petal : loadout.spawned) {
        const PetalInstance* instance = world.tryGet<PetalInstance>(petal);
        if (!instance || world.has<Dead>(petal)) continue;
        if (instance->slot < kLoadoutSlots) bySlot_[instance->slot].push_back(petal);
        loadout.spawned[kept++] = petal;
    }
    loadout.spawned.resize(kept);

    for (int i = 0; i < kLoadoutSlots; ++i) {
        const auto index = static_cast<std::size_t>(i);
        const auto slotId = static_cast<std::uint8_t>(i);
        LoadoutSlot& slot = loadout.slots[index];
        PetalSlotState::Slot& slotState = state.slots[index];
        std::vector<Entity>& live = bySlot_[index];

        if (slot.empty()) {
            if (slotState.configIndex != kNoPetal) {
                destroySlotPetals(world, loadout, slotId);
                recallPets(world, slotState);
                slotState = PetalSlotState::Slot{};
                slot.broken = false;
                slot.reloadReadyAtMillis = 0;
                live.clear();
            }
            continue;
        }

        const PetalConfig& config = registry.petal(slot.configIndex);
        const PetalStats stats = registry.petalStats(slot.configIndex, slot.rarity);
        const int count = std::max(0, stats.count);
        const double reload = reloadMillisFor(stats);

        if (slotState.configIndex != slot.configIndex || slotState.rarity != slot.rarity) {
            destroySlotPetals(world, loadout, slotId);
            recallPets(world, slotState);
            live.clear();
            slotState = PetalSlotState::Slot{};
            slotState.configIndex = slot.configIndex;
            slotState.rarity = slot.rarity;
            slotState.independent = config.independentHealth && count > 1;
            slotState.poolMax = stats.health;
            slotState.poolHealth = stats.health;
            slotState.syncedHealth = stats.health;
            slotState.instanceReadyAtMillis.assign(static_cast<std::size_t>(count), 0.0);
            // A newly equipped petal arrives whole. Inheriting the previous
            // occupant's reload would make swapping a way to dodge one.
            slot.broken = false;
            slot.reloadReadyAtMillis = 0;
        }

        if (!stats.breakable || count == 0) {
            // Pure modifiers and emitters have no health pool at all, so there
            // is nothing that can break and nothing to reload.
            slot.broken = false;
            slot.reloadReadyAtMillis = 0;
        } else if (slotState.independent) {
            // Each instance owns its health: the ones at zero go, alone, and
            // start their own timer. The slot as a whole only reads as broken
            // when nothing of it is left on the field.
            std::size_t survivors = 0;
            for (const Entity petal : live) {
                if (instanceHealth(world, petal) > 0.0) {
                    live[survivors++] = petal;
                    continue;
                }
                const PetalInstance* instance = world.tryGet<PetalInstance>(petal);
                if (instance && instance->subIndex < slotState.instanceReadyAtMillis.size()) {
                    slotState.instanceReadyAtMillis[instance->subIndex] = nowMillis + reload;
                }
                world.destroy(petal);
            }
            live.resize(survivors);
        } else if (!slot.broken && slotState.populated) {
            // Fold the cluster's damage back into the shared pool. Every
            // instance was left holding syncedHealth at the end of the last
            // tick, so whatever is missing from one now is damage combat dealt.
            double taken = 0;
            for (const Entity petal : live) {
                taken += std::max(0.0, slotState.syncedHealth - instanceHealth(world, petal));
            }
            const int missing = count - static_cast<int>(live.size());
            if (missing > 0) taken += slotState.syncedHealth * missing;
            slotState.poolHealth -= taken;

            if (slotState.poolHealth <= 0.0) {
                slotState.poolHealth = 0;
                destroySlotPetals(world, loadout, slotId);
                live.clear();
                recallPets(world, slotState);
                slotState.populated = false;
                slot.broken = true;
                slot.reloadReadyAtMillis = nowMillis + reload;
            }
        }

        if (slot.broken && !slotState.independent && nowMillis >= slot.reloadReadyAtMillis) {
            slot.broken = false;
            slot.reloadReadyAtMillis = 0;
            slotState.poolHealth = slotState.poolMax;
            slotState.syncedHealth = slotState.poolMax;
        }

        // Which cluster members are on the field. count is capped at 64 by the
        // config loader, so one word is enough and the loop below stays linear.
        std::uint64_t present = 0;
        for (const Entity petal : live) {
            const PetalInstance* instance = world.tryGet<PetalInstance>(petal);
            if (instance && instance->subIndex < 64) present |= 1ull << instance->subIndex;
        }

        const double spawnHealth = stats.breakable
                                       ? (slotState.independent ? stats.health : slotState.poolHealth)
                                       : 0.0;
        for (int k = 0; k < count && k < 64; ++k) {
            if ((present & (1ull << k)) != 0) continue;
            if (stats.breakable) {
                if (slotState.independent) {
                    const double ready = slotState.instanceReadyAtMillis[static_cast<std::size_t>(k)];
                    if (slotState.populated && nowMillis < ready) continue;
                } else if (slot.broken) {
                    continue;
                }
            }
            const Entity petal = spawnPetal(world, player, loadout, slotId,
                                            static_cast<std::uint8_t>(k),
                                            static_cast<std::uint8_t>(count), config, stats,
                                            slot.configIndex, slot.rarity, spawnHealth, nowMillis);
            if (petal == NULL_ENTITY) continue;
            live.push_back(petal);
            present |= 1ull << k;
            if (slotState.independent) {
                slotState.instanceReadyAtMillis[static_cast<std::size_t>(k)] = 0.0;
            }
        }
        // Sticky: once a slot has actually put petals on the field, an empty
        // ring means "they are all down", never "they have not spawned yet".
        // Only a rebuild or a shared-pool break clears it.
        if (!live.empty()) slotState.populated = true;

        if (stats.breakable && count > 0 && slotState.independent) {
            // Derived, not stored: the slot is on cooldown exactly while none
            // of its instances are out, and it comes back with the first one.
            int alive = 0;
            double earliest = 0;
            for (int k = 0; k < count && k < 64; ++k) {
                if ((present & (1ull << k)) != 0) {
                    ++alive;
                    continue;
                }
                const double ready = slotState.instanceReadyAtMillis[static_cast<std::size_t>(k)];
                if (earliest == 0 || ready < earliest) earliest = ready;
            }
            slot.broken = alive == 0;
            slot.reloadReadyAtMillis = slot.broken ? earliest : 0;
        }

        // Mirror the pool onto every instance so combat can damage whichever
        // grain it reaches and the fold above still adds up to one health bar.
        if (stats.breakable && !slotState.independent && !slot.broken) {
            slotState.syncedHealth = slotState.poolHealth;
            for (const Entity petal : live) {
                if (Health* health = world.tryGet<Health>(petal)) {
                    health->max = slotState.poolMax;
                    health->current = slotState.poolHealth;
                }
            }
        }
    }

    // Instances destroyed above are still named by the loadout's list. Dropping
    // them here keeps the invariant that everything in `spawned` is a live
    // petal, which placement and the action pass both rely on this same tick.
    kept = 0;
    for (const Entity petal : loadout.spawned) {
        if (!world.isAlive(petal)) continue;
        loadout.spawned[kept++] = petal;
    }
    loadout.spawned.resize(kept);
}

Entity PetalSystem::spawnPetal(World& world, Entity player, Loadout& loadout, std::uint8_t slot,
                               std::uint8_t subIndex, std::uint8_t subCount,
                               const PetalConfig& config, const PetalStats& stats,
                               std::uint16_t configIndex, Rarity rarity, double health,
                               double nowMillis) {
    const Transform* ownerTransform = world.tryGet<Transform>(player);
    if (!ownerTransform) return NULL_ENTITY;
    const Vec2 origin = ownerTransform->position;
    const Faction* ownerFaction = world.tryGet<Faction>(player);
    const Faction faction = ownerFaction ? *ownerFaction : Faction{Team::Players, false};

    const Entity petal = world.create();
    world.add<PetalTag>(petal);
    // Placed at the flower and moved onto the ring in the same tick, so a
    // reloaded petal never appears at the origin of the world for one frame.
    world.add<Transform>(petal, Transform{origin, 0.0});
    // Deliberately no Motion and no Knockback: the ring dictates a petal's
    // position every tick, so integrating or pushing it would be overwritten,
    // and the movement system would be doing work it cannot keep.
    if (!config.noPhysics) {
        world.add<Body>(petal, Body{stats.radius, 1.0});
        world.add<ContactDamage>(petal,
                                 ContactDamage{stats.damage,
                                               std::max(0.0, stats.damageIntervalMillis)});
        world.add<HitCooldowns>(petal);
    }
    if (health > 0.0) world.add<Health>(petal, Health{health, stats.health, 0.0, 0.0});
    world.add<Faction>(petal, faction);

    PetalInstance instance;
    instance.owner = player;
    instance.configIndex = configIndex;
    instance.rarity = rarity;
    instance.slot = slot;
    instance.subIndex = subIndex;
    instance.subCount = std::max<std::uint8_t>(1, subCount);
    // A petal that has just arrived waits out a full interval before acting,
    // so a broken projectile petal cannot be reloaded into an instant volley.
    instance.nextActionMillis =
        hasTimedAction(config, stats) ? nowMillis + actionIntervalMillis(config, stats) : 0.0;
    world.add<PetalInstance>(petal, instance);

    world.add<PetalEffect>(petal, PetalEffect{stats.poisonPerSecond, stats.poisonDurationMillis,
                                              stats.knockback, stats.slowFactor,
                                              stats.slowDurationMillis});

    Replicated replicated;
    replicated.kind = net::EntityKind::Petal;
    replicated.typeIndex = configIndex;
    replicated.rarity = rarity;
    world.add<Replicated>(petal, replicated);
    assignNetId(world, petal);

    loadout.spawned.push_back(petal);
    return petal;
}

void PetalSystem::destroySlotPetals(World& world, Loadout& loadout, std::uint8_t slot) {
    std::size_t kept = 0;
    for (const Entity petal : loadout.spawned) {
        const PetalInstance* instance = world.tryGet<PetalInstance>(petal);
        if (instance && instance->slot == slot) {
            world.destroy(petal);
            continue;
        }
        loadout.spawned[kept++] = petal;
    }
    loadout.spawned.resize(kept);
}

void PetalSystem::recallPets(World& world, PetalSlotState::Slot& state) {
    // Destroyed, not marked Dead: a recalled summon has not been killed, so it
    // must not raise a death event, award XP or drop anything.
    for (const Entity pet : state.pets) {
        if (world.isAlive(pet)) world.destroy(pet);
    }
    state.pets.clear();
}

void PetalSystem::assignNetId(World& world, Entity e) {
    if (allocateNetId) world.add<NetId>(e, NetId{allocateNetId()});
}

// ---------------------------------------------------------------------------
// Modifiers and ring geometry
// ---------------------------------------------------------------------------

PetalSystem::Aggregate PetalSystem::recomputeModifiers(World& world,
                                                       const ContentRegistry& registry,
                                                       Entity player) {
    Aggregate aggregate;
    aggregate.modifiers.magnetism = kBaseMagnetism;
    std::uint8_t equipFlags = EquipNone;

    if (const Loadout* loadout = world.tryGet<Loadout>(player)) {
        for (int i = 0; i < kLoadoutSlots; ++i) {
            const LoadoutSlot& slot = loadout->slots[static_cast<std::size_t>(i)];
            if (!slot.empty()) {
                // Equipment is worn for the whole loadout, including while a
                // petal is reloading; this is the same rule as tickBroadcast.
                equipFlags |= registry.petal(slot.configIndex).equipFlags;
            }
            // A broken petal is off the field and grants nothing. Anything else
            // makes breaking a petal free, and makes the ring's gap cosmetic.
            if (slot.empty() || slot.broken) continue;
            const PetalStats stats = registry.petalStats(slot.configIndex, slot.rarity);
            const PetalModifiers& mods = stats.modifiers;

            // ONE contribution per SLOT. A four-grain clump of sand is one
            // equipped petal, not four; summing per instance would make `count`
            // the strongest stat in the game.
            aggregate.modifiers.maxHealthScale *= mods.maxHealth;
            aggregate.modifiers.speedScale *= mods.speed;
            aggregate.modifiers.damageScale *= mods.damage;
            aggregate.modifiers.sizeScale *= mods.playerRadius;
            aggregate.modifiers.rangeScale *= mods.range;
            aggregate.modifiers.cameraZoom *= stats.cameraZoom;
            aggregate.spinScale *= mods.rotationSpeed;

            aggregate.modifiers.luck += mods.luck;
            aggregate.modifiers.magnetism += mods.magnetism;
            aggregate.modifiers.aggroRadiusBonus += mods.aggroRadius;
            aggregate.modifiers.passiveHealPerSecond += stats.passiveHealPerSecond;
        }
    }

    // Written wholesale. The component is never edited in place on equip: an
    // incremental version has to unwind exactly what it applied, and one missed
    // unwind is a stat the player keeps for the rest of the session.
    if (PlayerModifiers* out = world.tryGet<PlayerModifiers>(player)) *out = aggregate.modifiers;
    if (Body* body = world.tryGet<Body>(player)) {
        const PlayerProgress* progress = world.tryGet<PlayerProgress>(player);
        const int level = progress ? progress->level : 1;
        body->radius = playerRadiusForLevel(level) * std::max(0.0, aggregate.modifiers.sizeScale);
    }
    if (PlayerVisuals* visuals = world.tryGet<PlayerVisuals>(player)) {
        visuals->equipFlags = equipFlags;
    }
    return aggregate;
}

void PetalSystem::applyPassiveHeal(World& world, Entity player, const Aggregate& aggregate,
                                   double dt) {
    // Applied here, once per player, rather than per petal: the aggregate has
    // already summed every slot's contribution, and healing again per instance
    // would pay a clump its bonus `count` times.
    healPlayer(world, player, aggregate.modifiers.passiveHealPerSecond * dt);
}

void PetalSystem::updateRing(World& world, Entity player, const Aggregate& aggregate, double dt) {
    PetalRing* ring = world.tryGet<PetalRing>(player);
    if (!ring) return;
    const Body* body = world.tryGet<Body>(player);
    const PlayerInput* input = world.tryGet<PlayerInput>(player);
    const double playerRadius = body ? body->radius : kPlayerBaseRadius;
    // Matches TypeScript's `60 + (PLAYER_SIZE / 2) * (sizeMultiplier - 1)`.
    // `playerRadius` is the equivalent scaled hitbox radius in C++.
    const double neutralRadius = kPetalOrbitRestRadius + playerRadius - kPlayerBaseRadius;

    // Defend wins over attack: pulling the ring in is the defensive option, and
    // a player holding both is asking to block.
    double extension = 1.0;
    if (input) {
        if (input->current.defending()) extension = kPetalOrbitDefendExtension;
        else if (input->current.attacking()) extension = kPetalOrbitAttackExtension;
    }

    ring->targetRadius = neutralRadius * extension * std::max(0.0, aggregate.modifiers.rangeScale);
    // Eased, not snapped. Attack and defend are a push and a pull on the ring;
    // a petal that teleports outward reads as a bug rather than a lunge.
    ring->radius = damp(ring->radius, ring->targetRadius, kPetalRadiusDamp, dt);
    ring->spin = wrapAngle(ring->spin + kPetalSpinRate * aggregate.spinScale * dt);
}

void PetalSystem::placePetals(World& world, const ContentRegistry& registry, Entity player) {
    const Transform* ownerTransform = world.tryGet<Transform>(player);
    const PetalRing* ring = world.tryGet<PetalRing>(player);
    const Loadout* loadout = world.tryGet<Loadout>(player);
    if (!ownerTransform || !ring || !loadout) return;

    const Vec2 centre = ownerTransform->position;
    const double facing = ownerTransform->angle;
    const double ringRadius = ring->radius;
    const double spin = ring->spin;

    // The ring is shared out among the slots that HOLD a petal -- not among the
    // eight slots, and not among the petal entities. A broken petal therefore
    // leaves its gap open instead of making the rest of the ring lurch round to
    // close it, and a clump counts once because it occupies one slot.
    std::array<int, kLoadoutSlots> ordinal{};
    int occupied = 0;
    for (int i = 0; i < kLoadoutSlots; ++i) {
        ordinal[static_cast<std::size_t>(i)] = occupied;
        if (!loadout->slots[static_cast<std::size_t>(i)].empty()) ++occupied;
    }
    if (occupied == 0) return;
    const double wedge = kTau / occupied;

    for (const Entity petal : loadout->spawned) {
        PetalInstance* instance = world.tryGet<PetalInstance>(petal);
        Transform* transform = world.tryGet<Transform>(petal);
        if (!instance || !transform || instance->slot >= kLoadoutSlots) continue;
        const PetalConfig& config = registry.petal(instance->configIndex);
        const int subCount = std::max<int>(1, instance->subCount);

        double offset = wedge * ordinal[instance->slot];
        if (!config.clumped && subCount > 1) {
            // Not clumped, so `count` spreads across the slot's own wedge and
            // the ring stays evenly populated rather than stacking instances.
            offset += wedge * (static_cast<double>(instance->subIndex) - (subCount - 1) * 0.5) /
                      subCount;
        }
        instance->ringOffset = offset;

        // A fixed-direction petal is pinned to the flower's facing and does not
        // travel with the ring.
        const double angle = config.hasFixedDirection ? wrapAngle(facing + config.fixedDirection)
                                                      : wrapAngle(spin + offset);
        // noPhysics petals are pure modifiers and emitters: they ride on the
        // flower instead of taking a place on the ring.
        const double reach = config.noPhysics ? 0.0 : ringRadius * rangeMultiplier(config);

        Vec2 position = centre + Vec2::fromAngle(angle, reach);
        if (config.clumped && subCount > 1) {
            const Body* body = world.tryGet<Body>(petal);
            const double spacing = (body ? body->radius : 0.0) * kClumpSpacing;
            position += Vec2::fromAngle(angle + kTau * instance->subIndex / subCount, spacing);
        }
        transform->position = position;
        transform->angle = angle;
    }
}

// ---------------------------------------------------------------------------
// Per-petal actions
// ---------------------------------------------------------------------------

void PetalSystem::runActions(World& world, const ContentRegistry& registry, Entity player,
                             double nowMillis) {
    const Loadout* loadout = world.tryGet<Loadout>(player);
    PetalSlotState* state = world.tryGet<PetalSlotState>(player);
    if (!loadout || !state) return;
    const PlayerInput* input = world.tryGet<PlayerInput>(player);
    const bool defending = input && input->current.defending();

    // Snapshotted because an action creates entities, and a petal's slot state
    // is reached through the player's columns while that happens.
    actionList_ = loadout->spawned;

    for (const Entity petal : actionList_) {
        PetalInstance* instance = world.tryGet<PetalInstance>(petal);
        const Transform* transform = world.tryGet<Transform>(petal);
        if (!instance || !transform || instance->slot >= kLoadoutSlots) continue;

        const PetalConfig& config = registry.petal(instance->configIndex);
        // defendOnly is the whole identity of a petal like rose: outside a
        // block it is inert, which is what makes holding defend a decision.
        if (config.defendOnly && !defending) continue;

        const PetalStats stats = registry.petalStats(instance->configIndex, instance->rarity);
        if (!hasTimedAction(config, stats)) continue;
        if (nowMillis < instance->nextActionMillis) continue;

        // Armed before acting: the actions below create entities, and the
        // instance pointer is not worth carrying across that.
        instance->nextActionMillis = nowMillis + actionIntervalMillis(config, stats);
        const Vec2 at = transform->position;
        const Rarity rarity = instance->rarity;
        const std::uint16_t configIndex = instance->configIndex;
        const auto slot = instance->slot;

        if (config.projectile.present) {
            fireProjectiles(world, player, petal, config, stats, configIndex, rarity);
        }
        if (stats.heal > 0.0) {
            healPlayer(world, player, stats.heal);
        }
        if (config.radiation.present) {
            // The field is re-laid at the petal's feet every interval rather
            // than parented to it: a ground effect has no transform to follow,
            // and a patch that expires on the interval tracks the ring for free.
            const double interval = std::max(config.radiation.intervalMillis, net::kTickMillis);
            emitGroundEffect(world, player, at, GroundEffectKind::Radiation,
                             config.radiation.radius, stats.damage, 1.0, rarity,
                             interval / 1000.0);
        }
        if (config.webRadius > 0.0) {
            emitGroundEffect(world, player, at, GroundEffectKind::Web, config.webRadius, 0.0,
                             stats.slowFactor, rarity,
                             std::max(stats.slowDurationMillis, net::kTickMillis) / 1000.0);
        }
        if (config.petMobIndex != kInvalidIndex) {
            maintainPets(world, registry, player, slot, config,
                         state->slots[static_cast<std::size_t>(slot)]);
        }
    }
}

void PetalSystem::fireProjectiles(World& world, Entity player, Entity petal,
                                  const PetalConfig& config, const PetalStats& stats,
                                  std::uint16_t configIndex, Rarity rarity) {
    const ProjectileSpec& spec = config.projectile;
    // A shot with no speed or no reach is not a volley, it is an entity that
    // expires where it was born.
    if (spec.speed <= 0.0 || spec.distance <= 0.0) return;

    const Transform* origin = world.tryGet<Transform>(petal);
    if (!origin) return;
    const Vec2 from = origin->position;
    const double heading = origin->angle;
    const Faction* ownerFaction = world.tryGet<Faction>(player);
    const Faction faction = ownerFaction ? *ownerFaction : Faction{Team::Players, false};

    const int count = std::max(1, spec.count);
    // spreadAngle is the STEP between adjacent shots, not the width of the fan,
    // so the volley is centred on the petal's outward heading.
    const double first = heading - spec.spreadAngle * (count - 1) * 0.5;

    for (int i = 0; i < count; ++i) {
        const double angle = wrapAngle(first + spec.spreadAngle * i);
        const Entity shot = world.create();
        world.add<ProjectileTag>(shot);
        world.add<Transform>(shot, Transform{from, angle});
        world.add<Motion>(shot, Motion{Vec2::fromAngle(angle, spec.speed)});
        world.add<Body>(shot, Body{std::max(1.0, stats.radius * 0.5), 1.0});
        world.add<Faction>(shot, faction);

        Projectile projectile;
        projectile.owner = player;
        projectile.creditTo = player;
        projectile.damage = stats.damage;
        projectile.remainingDistance = spec.distance;
        projectile.petalConfigIndex = configIndex;
        projectile.rarity = rarity;
        projectile.seekRange = spec.seekRange;
        projectile.seekCone = spec.seekCone;
        world.add<Projectile>(shot, projectile);

        // Distance is the authority on range; the lifetime is the same limit
        // expressed in time, so a projectile that never hits anything still
        // dies on schedule even if nothing decrements the distance.
        world.add<Lifetime>(shot, Lifetime{spec.distance / spec.speed});
        world.add<PetalEffect>(shot, PetalEffect{stats.poisonPerSecond, stats.poisonDurationMillis,
                                                 stats.knockback, stats.slowFactor,
                                                 stats.slowDurationMillis});

        Replicated replicated;
        replicated.kind = net::EntityKind::Projectile;
        replicated.typeIndex = configIndex;
        replicated.rarity = rarity;
        world.add<Replicated>(shot, replicated);
        assignNetId(world, shot);
    }
}

void PetalSystem::emitGroundEffect(World& world, Entity player, Vec2 at, GroundEffectKind kind,
                                   double radius, double damagePerSecond, double slowFactor,
                                   Rarity rarity, double lifetimeSeconds) {
    if (radius <= 0.0 || lifetimeSeconds <= 0.0) return;
    const Entity effect = world.create();
    world.add<GroundEffectTag>(effect);
    world.add<Transform>(effect, Transform{at, 0.0});
    world.add<GroundEffect>(effect,
                            GroundEffect{kind, player, radius, damagePerSecond, slowFactor, rarity});
    world.add<Lifetime>(effect, Lifetime{lifetimeSeconds});

    Replicated replicated;
    replicated.kind = net::EntityKind::Effect;
    replicated.rarity = rarity;
    world.add<Replicated>(effect, replicated);
    assignNetId(world, effect);
}

void PetalSystem::maintainPets(World& world, const ContentRegistry& registry, Entity player,
                               std::uint8_t slot, const PetalConfig& config,
                               PetalSlotState::Slot& state) {
    std::size_t kept = 0;
    for (const Entity pet : state.pets) {
        if (world.isAlive(pet) && !world.has<Dead>(pet)) state.pets[kept++] = pet;
    }
    state.pets.resize(kept);

    const int wanted = std::max(0, config.petCount);
    if (static_cast<int>(state.pets.size()) >= wanted) return;

    const Transform* ownerTransform = world.tryGet<Transform>(player);
    if (!ownerTransform) return;
    const Vec2 ownerPosition = ownerTransform->position;
    const Faction* ownerFaction = world.tryGet<Faction>(player);
    const Faction faction = ownerFaction ? *ownerFaction : Faction{Team::Players, false};
    const MobStats mob = registry.mobStats(config.petMobIndex, config.petMobRarity);

    while (static_cast<int>(state.pets.size()) < wanted) {
        const Vec2 at = ownerPosition + rng_.insideCircle(mob.radius * 2.0 + kPlayerBaseRadius);
        const Entity pet = world.create();
        world.add<MobTag>(pet);
        world.add<Transform>(pet, Transform{at, rng_.angle()});
        world.add<Motion>(pet);
        world.add<Knockback>(pet);
        world.add<Body>(pet, Body{mob.radius, mob.mass});
        world.add<Health>(pet, Health{mob.health, mob.health, 0.0, 0.0});
        world.add<Faction>(pet, faction);
        world.add<MobType>(pet, MobType{config.petMobIndex, config.petMobRarity, 1.0});

        MobAi ai;
        // A summon fights, whatever the wild version of the mob does when left
        // to itself: a pet that will not seek is a decoration.
        ai.kind = AiKind::Hostile;
        ai.anchor = at;
        ai.aggroRange = mob.aggroRange > 0 ? mob.aggroRange : kMobActiveRadius * 0.25;
        world.add<MobAi>(pet, ai);

        world.add<ContactDamage>(pet, ContactDamage{mob.damage, kMobHitIntervalMillis});
        world.add<HitCooldowns>(pet);
        world.add<Afflictions>(pet);
        // Deliberately no Bounty: a pet awards no XP and drops nothing, so a
        // player's summons cannot be farmed by whoever kills them.
        world.add<Pet>(pet, Pet{player, slot});

        Replicated replicated;
        replicated.kind = net::EntityKind::Mob;
        replicated.typeIndex = config.petMobIndex;
        replicated.rarity = config.petMobRarity;
        replicated.spawnFlags = net::SpawnIsPet;
        world.add<Replicated>(pet, replicated);
        assignNetId(world, pet);

        state.pets.push_back(pet);
    }
}

} // namespace flr
