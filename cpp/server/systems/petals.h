#pragma once
// The petal ring: spawning it, placing it, breaking it and reloading it.
//
// The two components below carry this system's state and both live on the
// PLAYER, never on a petal. A broken slot has no petal entity left, so state
// kept there would be destroyed by the very event that has to be remembered --
// the break -- and the reload timer would go with it.
//
// Every number the ring uses comes out of the content registry as PetalStats.
// Nothing here re-derives a stat from a rarity: that ladder is rarity.h's job,
// and a second copy of it is how the two drift apart.

#include <array>
#include <cstdint>
#include <functional>
#include <memory>
#include <vector>

#include "shared/core/types.h"
#include "shared/core/world.h"
#include "shared/game/components.h"
#include "shared/game/config.h"

namespace flr {

/// Live state for one loadout slot's petals.
///
/// LoadoutSlot is the account-facing half -- what is equipped, whether it is
/// reloading -- and it is persisted. This is the simulation half, torn down and
/// rebuilt whenever the slot's petal or rarity changes.
struct PetalSlotState {
    struct Slot {
        /// The slot's shared health pool. A four-grain clump of sand has ONE
        /// pool: every grain mirrors it so combat can hit whichever is nearest,
        /// and the fold at the top of the next tick pulls the damage they took
        /// back into the pool.
        double poolHealth = 0;
        double poolMax = 0;
        /// What was last mirrored onto every instance. Whatever is missing from
        /// an instance now is exactly the damage it has taken since, which is
        /// why no per-instance previous-health array is needed.
        double syncedHealth = 0;

        /// `independentHealth`: each instance owns its health and breaks alone.
        /// The pool is then unused and instanceReadyAtMillis drives reloading.
        bool independent = false;

        /// False until the slot's instances have been spawned at least once.
        /// Without it the first tick would read "no petals on the field" as
        /// "the whole cluster was just destroyed" and break the slot instantly.
        bool populated = false;

        /// What the pool was built for. A slot whose petal or rarity no longer
        /// matches is rebuilt, which is also what makes swapping a petal hand
        /// you a fresh one instead of the previous occupant's health bar.
        std::uint16_t configIndex = kNoPetal;
        Rarity rarity = Rarity::Common;

        /// When cluster member i comes back, or 0 when it is already out.
        /// Sized to the petal's count; meaningful only while `independent`.
        std::vector<double> instanceReadyAtMillis;

        /// Mobs this slot has summoned. Handles are generation-checked, so a
        /// pet killed in the field simply stops being alive and is re-summoned.
        std::vector<Entity> pets;
    };
    std::array<Slot, kLoadoutSlots> slots{};
};

/// What a petal (or a projectile it fired) does to what it touches, resolved
/// once at spawn.
///
/// The combat system owns damage; it does not own the rules for turning a
/// config plus a rarity into these numbers. Publishing them on the entity keeps
/// contact resolution to a component read, and keeps the two systems from
/// disagreeing about what a tier means.
struct PetalEffect {
    double poisonPerSecond = 0;
    double poisonDurationMillis = 0;
    double knockback = 0;
    double slowFactor = 1.0;      ///< multiplies the victim's speed; 1 = none
    double slowDurationMillis = 0;
};

/// Owns a player's ring: which petals exist, where they are, when they break
/// and when they come back.
class PetalSystem {
public:
    /// One tick. Phase 4: after movement, so the ring orbits where the flower
    /// ended up; before combat, so a petal hits from its final position.
    void run(World& world, const ContentRegistry& registry, double nowMillis, double dt,
             CommandBuffer& commands);

    /// Wire ids for the entities this system spawns -- petals, projectiles,
    /// pets and ground effects.
    ///
    /// A net id has to be unique across the whole server, so the id space
    /// cannot belong to a system; whoever owns the allocator installs this
    /// hook. Left unset, everything still simulates and simply is not
    /// replicated, which is what a headless test wants.
    std::function<std::uint32_t()> allocateNetId;

private:
    /// The tick's summed passive bonuses. PlayerModifiers has no field for the
    /// ring's spin and only the few lines that place the ring want one, so it
    /// rides along here rather than growing the component.
    struct Aggregate {
        PlayerModifiers modifiers;
        double spinScale = 1.0;
    };

    void bindTo(World& world);

    void clearRing(World& world, Entity player);
    void reconcileSlots(World& world, const ContentRegistry& registry, Entity player,
                        double nowMillis);
    Aggregate recomputeModifiers(World& world, const ContentRegistry& registry, Entity player);
    void applyPassiveHeal(World& world, Entity player, const Aggregate& aggregate, double dt);
    void updateRing(World& world, Entity player, const Aggregate& aggregate, double dt);
    void placePetals(World& world, const ContentRegistry& registry, Entity player);
    void runActions(World& world, const ContentRegistry& registry, Entity player,
                    double nowMillis);

    /// `health` <= 0 spawns the petal with no Health component at all, which is
    /// what an unbreakable petal is: not one with zero hit points, which would
    /// break on its first tick.
    Entity spawnPetal(World& world, Entity player, Loadout& loadout, std::uint8_t slot,
                      std::uint8_t subIndex, std::uint8_t subCount, const PetalConfig& config,
                      const PetalStats& stats, std::uint16_t configIndex, Rarity rarity,
                      double health, double nowMillis);
    void destroySlotPetals(World& world, Loadout& loadout, std::uint8_t slot);
    void recallPets(World& world, PetalSlotState::Slot& state);
    void assignNetId(World& world, Entity e);

    void fireProjectiles(World& world, Entity player, Entity petal, const PetalConfig& config,
                         const PetalStats& stats, std::uint16_t configIndex, Rarity rarity);
    void emitGroundEffect(World& world, Entity player, Vec2 at, GroundEffectKind kind,
                          double radius, double damagePerSecond, double slowFactor,
                          Rarity rarity, double lifetimeSeconds);
    void maintainPets(World& world, const ContentRegistry& registry, Entity player,
                      std::uint8_t slot, const PetalConfig& config, PetalSlotState::Slot& state);

    World* bound_ = nullptr;
    std::unique_ptr<Query<PlayerTag, Transform, Loadout, PetalRing>> players_;

    std::vector<Entity> playerList_;
    std::vector<Entity> actionList_;
    /// One player's live petals bucketed by slot, rebuilt per player. Members
    /// so the per-tick work does not allocate.
    std::array<std::vector<Entity>, kLoadoutSlots> bySlot_;

    /// Pet spawn jitter only. Nothing here has to agree with the client, and a
    /// fixed seed makes a failing test reproducible.
    Rng rng_{0xB17E5EEDull};
};

} // namespace flr

FLR_COMPONENT(flr::PetalSlotState);
FLR_COMPONENT(flr::PetalEffect);
