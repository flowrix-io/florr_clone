// What the server reports becomes something to draw: ingestEvents() seeds the
// pools -- damage numbers, dying bodies, drop landings and pickups, glitter,
// explosions, lightning, hit flashes, screen shake -- and update() ages them
// once a frame.

#include "client/render/world_renderer_internal.h"

#include <algorithm>
#include <cmath>
#include <cstdint>
#include <iterator>
#include <utility>
#include <vector>

#include "client/ease.h"
#include "client/ui/item_tile.h"

namespace flix {

using namespace world_render;

namespace {

/// The browser build's number lost a hundredth of its alpha per frame, so at
/// 60 Hz it lived 100 frames. Half that here: the throw below covers the same
/// ground it always did, at twice the speed, so it has half as long to do it
/// in. Expressed in seconds so this client looks the same at any refresh rate.
constexpr double kNumberLifeSeconds = 50.0 / 60.0;
/// A number is thrown rather than floated: kNumberRise is the apex of its arc,
/// reached at kNumberArcPeak of its life, after which the same gravity carries
/// it back down past where it started while it fades out. kNumberDrift is how
/// far sideways it can be thrown over a whole life, either way -- a random
/// sideways speed is what keeps two numbers off the same mob from tracing one
/// line on top of each other.
/// Both are a life's worth of travel, and the life above is what sets the pace
/// they are covered at.
constexpr double kNumberRise = 100.0;

constexpr double kNumberDrift = 45.0;
/// Both spawn 20 world units above the body that was hit.
constexpr double kNumberSpawnRise = 20.0;
/// Damage to a flower is reported per hit; damage to a mob is throttled into a
/// 100 ms bucket. Both sizes are the floor a small hit is drawn at -- the
/// number grows with what it reports, up to kNumberMaxSize.
constexpr double kPlayerNumberSize = 30.0;
constexpr double kMobNumberSize = 30.0;
/// The ceiling a number stops growing at, and the hit that reaches it. The
/// ramp between the two is logarithmic: damage spans several orders of
/// magnitude over a run, and a linear ramp would put every hit worth reading
/// at the top of it within the first biome.
constexpr double kNumberMaxSize = 40.0;
constexpr double kNumberMaxSizeDamage = 1000.0;
constexpr double kDamageTextThrottleSeconds = 0.1;
/// The smallest mob damage total that is drawn: anything less rounds to "-0".
/// Smaller totals keep accumulating until they reach it.
constexpr double kMinShownDamage = 0.5;
constexpr std::uint32_t kDamageTextColor = ui::kStatDamage;

/// Ceilings on the two per-mob tables the renderer keeps of its own accord.
constexpr std::size_t kMaxDyingMobs = 64;
/// A flower going down takes its whole ring at once, and a screen of them is
/// still a few hundred.
constexpr std::size_t kMaxDyingPetals = 512;
/// Loot that vanished at once -- leaving a world drops every drop in view in
/// one frame -- animates out under the same kind of ceiling.
constexpr std::size_t kMaxDyingDrops = 64;
constexpr std::size_t kMaxMobShadows = 1024;

/// Explosion: a ring pair plus debris, all of it over one second.
constexpr double kExplosionLifeSeconds = 1.0;

/// How long one straight run of a bolt is before it breaks again, in world
/// units. Random per bolt inside the range, so two arms of the same strike
/// covering the same distance do not break in the same places.
constexpr double kLightningSegmentMin = 50.0;
constexpr double kLightningSegmentSpread = 100.0;
/// Arms kept alive at once. A strike reports at most net::kMaxLightningTargets,
/// so this is four overlapping strikes' worth; past it the newest is dropped,
/// which in a crowd that dense is a white patch either way.
constexpr std::size_t kMaxLightningBolts = 96;

/// The browser build integrates its particles once per 60 Hz frame; both its
/// velocities and its 16 ms life step are therefore per frame, not per second.
constexpr double kFramesPerSecond = 60.0;

constexpr double kDropSpawnNear = ui::kDropLandNear;
constexpr double kDropSpawnSpread = ui::kDropLandSpread;

/// The high rarities glitter, florr's way, read out of its client: the drop
/// pass of the world renderer (0x10077b370) gives every drop of Ultra and up
/// its own particle system, and the shared stepper (0x100793cc0) moves and
/// paints it. A drop throws one grain every 20 ms -- a filled square of side
/// U(2,5) x 3 in the drop's rarity colour, from the drop's centre, at
/// U(0,400) units/s in any direction -- with drag x0.95 per 60 Hz frame, no
/// gravity, a full turn a second, and an alpha that runs out linearly over
/// U(500,1000) ms while the side holds.
///
/// florr gives an equipped petal no glitter of its own; the round glints below
/// are the browser build's.
constexpr double kGrainSeconds = 0.020;
constexpr double kGrainSpeedMax = 400.0;
constexpr double kGrainDragPerFrame = 0.95;
constexpr double kGrainSpin = kTau;
constexpr double kGrainLifeMs = 500.0;
constexpr double kGrainLifeSpreadMs = 500.0;
constexpr double kGrainSide = 6.0;
constexpr double kGrainSideSpread = 9.0;
/// A drop throws a handful of the same grains at once as it lands. florr's
/// drops land without one: the burst is the browser build's, and only its
/// count still comes from there.
constexpr int kDropBurstCount = ui::kDropBurstCount;
/// The burst goes into the flat drop pool with the shimmer rather than into
/// the effect pool: wrapped in an Effect it competed with the damage numbers a
/// dying mob produces in the same tick, and the burst -- which is the one that
/// arrives exactly when the mob dies -- was the half that got dropped.
///
/// A drop keeps about 50 x 0.75 = 38 grains alive, so a screen of them is
/// bounded here rather than by the effect pool it no longer shares.
constexpr std::size_t kMaxDropSparkles = 512;
/// The trickle stops short of the cap so a landing burst always has room: the
/// shimmer is continuous and would otherwise hold the whole pool, and a burst
/// silently swallowed is the thing a player notices.
constexpr std::size_t kDropShimmerBudget = kMaxDropSparkles * 3 / 4;

/// An equipped petal's glint, the browser build's: rolled per drawn frame, per
/// petal, a spoked burst of soft discs in the rarity colour lifted halfway to
/// white, drifting slowly out as they shrink and fade.
constexpr double kSparkleChance = 0.1;
constexpr int kSparkleCount = 8;
constexpr double kSparkleLifeSeconds = 3.0;
constexpr double kSparkleWhiten = 0.5;

/// Moves one pool of grains on by `dt` in the stepper's order -- drift, then
/// drag, then turn -- and forgets the ones that have faded out.
void stepGrains(std::vector<EffectParticle>& grains, double dt) {
    const double drag = std::pow(kGrainDragPerFrame, dt * kFramesPerSecond);
    for (EffectParticle& p : grains) {
        p.position += p.velocity * dt;
        p.velocity *= drag;
        p.rotation += kGrainSpin * dt;
        p.lifeSeconds -= dt;
    }
    grains.erase(std::remove_if(grains.begin(), grains.end(),
                                [](const EffectParticle& p) { return p.lifeSeconds <= 0; }),
                 grains.end());
}

/// A poison tick is purple and stands 14 units to the right of the body, so a
/// petal hit landing in the same tick cannot stack on top of it.
constexpr std::uint32_t kPoisonTextColor = ui::kStatPoison;
constexpr double kPoisonNumberOffsetX = 14.0;

/// A lightning strike's damage is the lightning cyan the tooltips name it in.
///
/// Not offset the way a poison tick is: a strike IS a landed hit, and it opens
/// the victim's post-hit window, so nothing else can land on the same body in
/// the same tick for it to stack on.
constexpr std::uint32_t kLightningTextColor = ui::kStatLightning;
/// A glitch petal's hit (net::DamageGlitch).
constexpr std::uint32_t kGlitchTextColor = ui::kStatGlitch;

/// Which floating number a hit belongs to.
///
/// Not just a colour: each channel accumulates on its own key inside the mob
/// throttle. Sharing one bucket would let a poison tick land inside a petal
/// hit's window and repaint the whole total purple -- or a strike's cyan repaint
/// the ring damage that arrived beside it -- and the reverse.
enum class NumberChannel : std::uint8_t { Hit = 0, Poison = 1, Lightning = 2, Glitch = 3 };

std::uint32_t numberColor(NumberChannel channel) {
    switch (channel) {
        case NumberChannel::Poison: return kPoisonTextColor;
        case NumberChannel::Lightning: return kLightningTextColor;
        case NumberChannel::Glitch: return kGlitchTextColor;
        case NumberChannel::Hit: break;
    }
    return kDamageTextColor;
}

/// The throttle bucket one channel's numbers accumulate in for one body. The
/// channel rides above the 32-bit net id, which is the whole of the key.
std::uint64_t numberKey(std::uint32_t netId, NumberChannel channel) {
    return static_cast<std::uint64_t>(netId) |
           (static_cast<std::uint64_t>(channel) << 32);
}

/// The channel a Damage event's flag byte names.
NumberChannel channelOf(std::uint8_t flags) {
    // Poison first: a poisoned strike is not a thing any content can author,
    // and reading the byte in a fixed order beats leaving the answer to
    // whichever bit a future flag happens to occupy.
    if ((flags & net::DamagePoison) != 0) return NumberChannel::Poison;
    if ((flags & net::DamageGlitch) != 0) return NumberChannel::Glitch;
    if ((flags & net::DamageLightning) != 0) return NumberChannel::Lightning;
    return NumberChannel::Hit;
}

/// The type size for a hit of `value`, between `base` and kNumberMaxSize.
double numberSizeFor(double base, double value) {
    if (value <= 1.0 || base >= kNumberMaxSize) return base;
    const double t = clamp(std::log(value) / std::log(kNumberMaxSizeDamage), 0.0, 1.0);
    return base + (kNumberMaxSize - base) * t;
}

/// Ultra and up glitter: florr's drop pass tests the rarity byte against 6,
/// which is Ultra on our ladder too, and every tier above it passes. The
/// petals' glints take the same tiers.
bool sparklingRarity(Rarity rarity) {
    return rarity >= Rarity::Ultra;
}

/// Jitter for a particle burst. Deliberately not reproducible across clients:
/// nothing seeded from it is simulated, and debris that matched frame for
/// frame on two machines would still look the same as debris that did not.
double randomUnit() {
    static std::uint32_t state = 0x2545F491u;
    state ^= state << 13;
    state ^= state >> 17;
    state ^= state << 5;
    return static_cast<double>(state >> 8) * (1.0 / 16777216.0);
}

/// One grain of `rarity`'s colour thrown from `at` (see kGrainSeconds).
EffectParticle florrGrain(Vec2 at, Rarity rarity) {
    const double angle = randomUnit() * kTau;
    const double speed = randomUnit() * kGrainSpeedMax;
    EffectParticle grain;
    grain.position = at;
    grain.velocity = {std::cos(angle) * speed, std::sin(angle) * speed};
    grain.lifeSeconds = grain.maxLifeSeconds =
        (kGrainLifeMs + randomUnit() * kGrainLifeSpreadMs) / 1000.0;
    grain.size = kGrainSide + randomUnit() * kGrainSideSpread;
    grain.rotation = randomUnit() * kTau;
    grain.color = rarityColor(rarity);
    return grain;
}

/// How many grains a body owes for (`from`, `to`]: one on every 20 ms tick of
/// a clock shifted by a phase hashed from its net id. florr keeps a deadline
/// per drop for this; a phase gives the same steady 50 a second with nothing
/// stored per drop, and keeps drops that landed together from throwing in step.
int grainsDue(std::uint32_t netId, double from, double to) {
    const double phase =
        static_cast<double>((netId * 2654435761u) >> 8) * (kGrainSeconds / 16777216.0);
    return static_cast<int>(std::floor((to + phase) / kGrainSeconds) -
                            std::floor((from + phase) / kGrainSeconds));
}

/// Lays out one arm of a strike: `from` to `to`, broken into runs that each
/// wander off the straight line.
///
/// Ported from the style reference's own bolt: the line is cut into equal runs,
/// and each run's MIDPOINT is displaced by a random vector no longer than half
/// the run. Displacing the midpoints rather than the joints is what keeps the
/// arm anchored at both ends however hard it is shaken -- it starts where the
/// strike landed and finishes on the mob, which is the whole point of drawing
/// it.
void buildLightningBolt(Vec2 from, Vec2 to, std::vector<Vec2>& out) {
    out.clear();
    out.push_back(from);
    const Vec2 delta = to - from;
    const double distance = delta.length();
    if (distance <= 1e-9) {
        out.push_back(to);
        return;
    }
    const Vec2 direction = delta / distance;
    const double runLength = kLightningSegmentMin + kLightningSegmentSpread * randomUnit();
    const int runs = std::max(1, static_cast<int>(std::ceil(distance / runLength)));
    const double half = distance / runs / 2.0;
    out.reserve(static_cast<std::size_t>(runs) + 2);
    for (int i = 0; i < runs; ++i) {
        const double along = (2.0 * i + 1.0) * half;
        const double jitterAngle = kTau * randomUnit();
        const double jitter = half * randomUnit();
        out.push_back({from.x + direction.x * along + std::cos(jitterAngle) * jitter,
                       from.y + direction.y * along + std::sin(jitterAngle) * jitter});
    }
    out.push_back(to);
}

// The hit flash, read out of florr's client (the entity's tint list and the
// handler for its damage message). Its damage message carries a byte; what
// florr's server packs into it is not in the client, and this server sends
// the hit's share of max health.
/// How long one hit colours the body.
constexpr double kHitFlashSeconds = 0.150;
/// The share of a flash's life, counted from the end, still drawn white
/// rather than red: the first 15 ms.
constexpr double kHitFlashWhiteFrom = 0.9;
/// intensity = clamp(share^0.5, 0.1, 1): a hit for a hundredth of the bar or
/// less flashes at the floor, a tenth at 0.32, and a hit for nothing at all
/// still shows. florr's curve is share^0.2 on a byte, which is steep at the
/// bottom: a chip for half a percent of the bar -- an apex leaf on an ultra
/// termite overmind -- flashed at a third, over a body that fills the
/// screen, while the super, a step under 1/255, sat at the floor.
constexpr double kHitFlashExponent = 0.5;
constexpr double kHitFlashFloor = 0.1;
/// The strongest the composited tint ever gets, as an alpha: florr's goes to
/// full white, and a body hit hard and often strobes white at that. Every
/// hit's colour still lands -- the whole tint is scaled down under this.
constexpr double kHitFlashMaxAlpha = 0.5;
/// More hits than a full ring lands in 150 ms, many times over. florr's list
/// is unbounded; past this the oldest goes, which at these alphas is invisible.
constexpr std::size_t kMaxHitFlashes = 64;

// The screen shake, out of the same client: its damage handler feeds a pool
// when the hit is on your own flower, and its camera update turns the pool
// into a push. See WorldRenderer::shakeOffset().
/// The pool's decay and the level's rise and fall, florr's expm1 rates.
const double kShakePoolEaseSeconds = easeTimeConstantFromRatePerMs(0.0030775976632530346);
const double kShakeLevelEaseSeconds = easeTimeConstantFromRatePerMs(0.013388613078852581);
/// How long after a hit the level is held at 1.
constexpr double kShakeHoldSeconds = 0.200;
/// The push at full strength, in screen units at any zoom.
constexpr double kShakeReach = 5.0;
/// A pool of 1/50 of the bar is already full strength.
constexpr double kShakePoolGain = 50.0;
/// The push's angle turns at 0.01 rad/ms and its length swings at 0.05.
constexpr double kShakeTurnPerMs = 0.01;
constexpr double kShakeSwingPerMs = 0.05;
/// A ritual's pushes: one per 100 ms, catching up at most 300 ms of missed
/// ones, each adding this much of how far the ritual has traced.
constexpr double kRitualShakePushSeconds = 0.100;
constexpr double kRitualShakeCatchUpSeconds = 0.300;
constexpr double kRitualShakePerTraced = 0.5;

} // namespace

void WorldRenderer::ingestEvents(WorldView& view) {
    const auto isPlayer = [&view](std::uint32_t netId) {
        const auto it = view.entities().find(netId);
        return it != view.entities().end() && it->second.kind == net::EntityKind::Player;
    };
    // A number thrown off a body that is not drawn would hang over nothing.
    const auto isHidden = [this, &view](std::uint32_t netId) {
        const auto it = view.entities().find(netId);
        return it != view.entities().end() && hiddenByOptions(it->second);
    };
    // The dummy exists to be hit at, so it reports what it is being hit for --
    // by YOU. The same ten-second window the browser build's server kept, but
    // over the damage events the server marks as this viewer's own
    // (net::DamageByViewer): a dummy is a measure of your build, and one that
    // summed everybody's hits would credit you with the flower beside you.
    const auto isTargetDummy = [this, &view](std::uint32_t netId) {
        if (!content_) return false;
        const auto it = view.entities().find(netId);
        if (it == view.entities().end()) return false;
        // The mob the admin spawns, or the NPC a map stands on its plot: the
        // same dummy, counted the same way.
        if (it->second.kind != net::EntityKind::Mob && it->second.kind != net::EntityKind::Npc) {
            return false;
        }
        return content_->mob(it->second.typeIndex).id == "target_dummy";
    };
    const auto pushNumber = [this](Vec2 at, double value, double size, NumberChannel channel) {
        if (effects_.size() >= maxEffects) return;
        const bool poison = channel == NumberChannel::Poison;
        Effect e;
        e.kind = Effect::Kind::DamageNumber;
        // Reported 20 units above the body that produced it, and a poison tick
        // 14 units to the side of that so it cannot land under the petal hit
        // that arrived in the same tick.
        e.position = {at.x + (poison ? kPoisonNumberOffsetX : 0.0), at.y - kNumberSpawnRise};
        // The throw: a sideways speed picked per number, and the apex the arc
        // is scaled to. `drift` is a whole life's worth of travel in both, so
        // the draw only has to weigh it by the shape of the path.
        e.drift = {kNumberDrift * (randomUnit() * 2.0 - 1.0), -kNumberRise};
        e.value = value;
        e.textSize = numberSizeFor(size, value);
        e.color = numberColor(channel);
        e.lifeSeconds = kNumberLifeSeconds;
        effects_.push_back(std::move(e));
    };

    // A petal's glint: disc-shaped grains in the browser build's spoked
    // emission -- evenly spaced angles with a little jitter. The browser build
    // integrates these once per 60 Hz frame, so its speeds are per frame and
    // are converted here the way the explosion's debris is.
    const auto pushSparkle = [this](Vec2 at, Rarity rarity, int count, double speedBase,
                                    double speedSpread, double lifeBase, double lifeSpread,
                                    double sizeBase, double sizeSpread, double lifetime) {
        // Half the pool, not all of it. The browser build keeps its shimmer in
        // a separate array from its damage numbers; sharing one here without a
        // reservation lets a loadout of ultra petals fill the pool and silence
        // every number on screen, which is the one thing that must never go.
        if (effects_.size() >= maxEffects / 2) return;
        Effect e;
        e.kind = Effect::Kind::Sparkle;
        e.position = at;
        e.lifeSeconds = lifetime;
        const std::uint32_t color = ui::lighten(rarityColor(rarity), kSparkleWhiten);
        e.particles.reserve(static_cast<std::size_t>(count));
        for (int i = 0; i < count; ++i) {
            const double angle = kTau * i / count + randomUnit() * 0.3;
            const double speed = (speedBase + randomUnit() * speedSpread) * kFramesPerSecond;
            const double life = (lifeBase + randomUnit() * lifeSpread) / 1000.0;
            EffectParticle particle;
            particle.position = {at.x + (randomUnit() - 0.5) * 4.0,
                                 at.y + (randomUnit() - 0.5) * 4.0};
            particle.velocity = {std::cos(angle) * speed, std::sin(angle) * speed};
            particle.lifeSeconds = particle.maxLifeSeconds = life;
            particle.size = sizeBase + randomUnit() * sizeSpread;
            particle.color = color;
            e.particles.push_back(particle);
        }
        effects_.push_back(std::move(e));
    };

    // One grain of a drop's glitter, shimmer or landing burst alike. Both go
    // straight into the flat pool with no effect wrapping them: every grain
    // lives on its own clock and shares nothing with the ones around it, and
    // the pool is the drops' own, so a screenful of damage numbers can never
    // silence it. `budget` is how much of that pool the caller may take -- the
    // continuous shimmer stops short of the cap, a burst may fill it.
    const auto pushDropGrain = [this](Vec2 at, Rarity rarity, std::size_t budget) {
        if (dropSparkles_.size() < budget) dropSparkles_.push_back(florrGrain(at, rarity));
    };

    for (const ViewEvent& event : view.events()) {
        switch (event.kind) {
            case net::EventKind::Damage: {
                {
                    // florr carries the share as a byte, and a hit under 1/255
                    // of the bar is a zero that flashes at the floor.
                    const double share =
                        std::floor(clamp(event.radius, 0.0, 1.0) * 255.0) / 255.0;
                    // Everything a body takes before the next frame is ONE
                    // flash, for the total. A colony splits each swing over
                    // every termite in reach and reports each share as its
                    // own hit, so a termite in a cluster -- the overmind,
                    // whose reach is the longest, most of all -- took a
                    // flash for every swing at any of its neighbours, each
                    // at the floor's tenth at least, and twenty of those
                    // laid over each other wash the body out to white.
                    foldHit(hitFlashes_[event.netId], event.radius);
                    // A petal or a shot: the flash is the whole of it -- and
                    // when the petal is one of ours, its tile's on the bar.
                    if ((event.flag & net::DamageFlashOnly) != 0) {
                        if (event.otherNetId >= 1 && event.otherNetId <= kLoadoutActiveSlots) {
                            foldHit(slotFlashes_[event.otherNetId - 1], event.radius);
                        }
                        break;
                    }
                    // The viewer's own flower being hit shakes the screen.
                    const auto self = view.entities().find(event.netId);
                    if (self != view.entities().end() && self->second.isSelf()) {
                        shakePool_ += share;
                        shakeHitSeconds_ = nowSeconds_;
                        shakeHeld_ = true;
                    }
                }
                if ((event.flag & net::DamageByViewer) != 0 && isTargetDummy(event.netId)) {
                    dummyDamage_[event.netId].emplace_back(nowSeconds_, event.amount);
                }
                // A squadmate's hit far off screen is here for the party HUD's
                // flash only (net::DamageOffView).
                if (!options.damageNumbers || isHidden(event.netId) ||
                    (event.flag & net::DamageOffView) != 0) {
                    break;
                }
                // A flower's own damage is never throttled: you must see every
                // hit you take. A mob's is, because a full ring lands eight
                // hits in one tick and eight stacked numbers read as noise.
                // Each channel accumulates under its own key -- see
                // NumberChannel.
                const NumberChannel channel = channelOf(event.flag);
                if (isPlayer(event.netId)) {
                    pushNumber(event.position, event.amount, kPlayerNumberSize, channel);
                    break;
                }
                const std::uint64_t key = numberKey(event.netId, channel);
                const auto bucket = damageTextAt_.find(key);
                if (bucket != damageTextAt_.end() &&
                    nowSeconds_ - bucket->second < kDamageTextThrottleSeconds) {
                    damagePending_[key] += event.amount;
                    break;
                }
                double total = event.amount;
                const auto pending = damagePending_.find(key);
                if (pending != damagePending_.end()) total += pending->second;
                // A total that would print as "-0" is held until it adds up to
                // a point. A termite colony splits every hit across thirty
                // bodies, so each one is struck for a fraction of a point at a
                // time, and drawing each fraction at once would show nothing
                // but zeros.
                if (total < kMinShownDamage) {
                    damagePending_[key] = total;
                    break;
                }
                if (pending != damagePending_.end()) damagePending_.erase(pending);
                damageTextAt_[key] = nowSeconds_;
                pushNumber(event.position, total, kMobNumberSize, channel);
                break;
            }
            case net::EventKind::Killed: {
                // Whatever was still accumulating dies with the target, so
                // flush it rather than losing the killing blow's number. EVERY
                // bucket: a mob can die with a petal hit, a poison tick, a
                // strike and a glitch hit all still pending.
                for (const NumberChannel channel :
                     {NumberChannel::Hit, NumberChannel::Poison, NumberChannel::Lightning,
                      NumberChannel::Glitch}) {
                    const std::uint64_t key = numberKey(event.netId, channel);
                    const auto pending = damagePending_.find(key);
                    if (pending != damagePending_.end()) {
                        if (options.damageNumbers && pending->second >= kMinShownDamage) {
                            pushNumber(event.position, pending->second, kMobNumberSize, channel);
                        }
                        damagePending_.erase(pending);
                    }
                    damageTextAt_.erase(key);
                }
                dummyDamage_.erase(event.netId);

                // The snapshot erased the entity before this event was read, so
                // the death animation replays the last state it was DRAWN in:
                // a petal's or a shot's the view set aside as it erased it,
                // a mob's the shadow kept below. A drop has no death.
                std::vector<RemoteEntity>& removed = view.removedPetals();
                const auto petal =
                    std::find_if(removed.begin(), removed.end(), [&](const RemoteEntity& e) {
                        return e.netId == event.netId;
                    });
                if (petal != removed.end()) {
                    if (dyingPetals_.size() < kMaxDyingPetals && !hiddenByOptions(*petal)) {
                        dyingPetals_.push_back(DyingPetal{std::move(*petal), 0.0});
                    }
                    // Moved from, so it must not be found a second time.
                    petal->netId = 0;
                    break;
                }
                const auto shadow = mobShadows_.find(event.netId);
                if (shadow == mobShadows_.end()) break;
                if (dying_.size() < kMaxDyingMobs) {
                    DyingMob mob;
                    mob.netId = shadow->second.netId;
                    mob.position = event.position;
                    mob.angle = shadow->second.angle;
                    mob.radius = shadow->second.radius;
                    mob.typeIndex = shadow->second.typeIndex;
                    mob.rarity = shadow->second.rarity;
                    mob.pet = shadow->second.pet;
                    dying_.push_back(mob);
                }
                mobShadows_.erase(shadow);
                break;
            }
            case net::EventKind::Explosion: {
                if (effects_.size() >= maxEffects) break;
                Effect e;
                e.kind = Effect::Kind::Explosion;
                e.position = event.position;
                e.radius = event.radius > 0 ? event.radius : 60;
                e.lifeSeconds = kExplosionLifeSeconds;

                const int count = static_cast<int>(clamp(e.radius / 5.0, 10.0, 50.0));
                e.particles.reserve(static_cast<std::size_t>(count));
                for (int i = 0; i < count; ++i) {
                    const double angle = kTau * i / count + randomUnit() * 0.5;
                    const double speed = (2.0 + randomUnit() * 3.0) * kFramesPerSecond;
                    const double life = (800.0 + randomUnit() * 400.0) / 1000.0;
                    EffectParticle p;
                    p.position = {e.position.x + (randomUnit() - 0.5) * 10.0,
                                  e.position.y + (randomUnit() - 0.5) * 10.0};
                    p.velocity = {std::cos(angle) * speed, std::sin(angle) * speed};
                    p.lifeSeconds = p.maxLifeSeconds = life;
                    p.size = 2.0 + randomUnit() * 3.0;
                    p.color = randomUnit() > 0.5 ? kExplosionOuter : kExplosionInner;
                    e.particles.push_back(p);
                }
                effects_.push_back(std::move(e));
                break;
            }
            case net::EventKind::Lightning: {
                // One arm per mob the strike hit. The endpoints are the
                // server's, not the entity table's: the strike's damage lands a
                // tick later, so some of these mobs are already dead and gone
                // from the table by the time this is read -- and a bolt to the
                // mob it just killed is precisely the bolt to draw.
                for (const Vec2& target : event.points) {
                    if (bolts_.size() >= kMaxLightningBolts) break;
                    LightningBolt bolt;
                    bolt.glitch = (event.flag & net::DamageGlitch) != 0;
                    buildLightningBolt(event.position, target, bolt.points);
                    bolts_.push_back(std::move(bolt));
                }
                break;
            }
            case net::EventKind::PickedUp: {
                // Somebody else's pickup is NOT by itself the end of the item.
                // A drop is shared: it pays out one copy to each eligible
                // flower and the entity survives until the last of them has
                // taken it, so a squadmate collecting from a pile the viewer
                // is standing in leaves every item exactly where it lies.
                // Flying a copy off to them there shows the viewer an item
                // leaving that has not left -- and, when the drop is one the
                // viewer never held at all, an item that was never there.
                //
                // So a remote taker only stakes a CLAIM here. The flight is
                // played below, by the same absence that plays the despawn
                // spin, if and when the snapshot really does stop carrying the
                // drop; nothing is conjured for a drop this client never saw.
                const auto known = knownDrops_.find(event.netId);
                if (event.otherNetId != view.self().netId) {
                    if (known != knownDrops_.end()) {
                        known->second.pendingTakerNetId = event.otherNetId;
                    }
                    break;
                }

                // The viewer's own pickup. This one is certain -- the item is
                // in their inventory whatever the entity does next -- so the
                // flight plays immediately, from the record kept here because
                // the drop is usually erased from the snapshot in the same
                // tick.
                DyingDrop drop;
                if (known != knownDrops_.end()) {
                    drop = known->second;
                    knownDrops_.erase(known);
                } else {
                    // Never held: magnetism is a pickup RADIUS, so loot that
                    // lands inside it is taken on the tick it spawned and no
                    // snapshot ever carried the entity. That is not a rare
                    // case -- an apex observer reaches 437 units and a magnet
                    // 2187, further than a flower's petals kill -- and playing
                    // nothing at all is what makes a well-equipped flower look
                    // like mobs stopped dropping loot. The cue carries the
                    // drop's position and look for exactly this, so the item
                    // is materialised here and takes the ordinary flight.
                    drop.netId = event.netId;
                    drop.position = event.position;
                    drop.typeIndex = static_cast<std::uint16_t>(event.amount);
                    drop.rarity = clampRarity(static_cast<int>(event.flag));
                    for (int i = 0; i < kDropBurstCount; ++i) {
                        pushDropGrain(drop.position, drop.rarity, kMaxDropSparkles);
                    }
                }
                drop.takerNetId = event.otherNetId;
                drop.pendingTakerNetId = 0;
                drop.ageSeconds = 0;
                drop.seenThisFrame = false;
                if (dyingDrops_.size() < kMaxDyingDrops) dyingDrops_.push_back(drop);
                dropSpawns_.erase(event.netId);
                break;
            }
            default:
                break;
        }
    }
    view.events().clear();
    view.removedPetals().clear();

    // --- drops -----------------------------------------------------------
    //
    // A drop's arrival and departure are both absences rather than events: it
    // simply appears in, and disappears from, the entity stream. Both have a
    // flourish, so both are recovered by diffing what is on screen against
    // what was last frame. Done AFTER the events above so a pickup has already
    // claimed its drop and is not mistaken for a timeout.
    for (const auto& entry : view.entities()) {
        const RemoteEntity& entity = entry.second;
        if (entity.kind != net::EntityKind::Drop) continue;
        DyingDrop& record = knownDrops_[entity.netId];
        const bool firstSight = record.netId == 0;
        record.netId = entity.netId;
        record.position = entity.position;
        record.typeIndex = entity.typeIndex;
        record.rarity = entity.rarity;
        record.seenThisFrame = true;
        if (!firstSight) continue;

        DropSpawn spawn;
        spawn.angle = randomUnit() * kTau;
        spawn.distance = kDropSpawnNear + randomUnit() * kDropSpawnSpread;
        spawn.rotation = (randomUnit() - 0.5) * kTau;
        dropSpawns_[entity.netId] = spawn;
        for (int i = 0; i < kDropBurstCount; ++i) {
            pushDropGrain(entity.position, entity.rarity, kMaxDropSparkles);
        }
    }
    for (auto it = knownDrops_.begin(); it != knownDrops_.end();) {
        if (it->second.seenThisFrame) {
            it->second.seenThisFrame = false;
            // Still on the wire after somebody else collected from it, so
            // theirs was one copy of a shared drop and the item has not gone
            // anywhere. Dropping the claim matters: unless it is cleared, the
            // drop's eventual TIMEOUT would fly it off to a flower that took
            // its copy seconds earlier instead of spinning out where it lies.
            it->second.pendingTakerNetId = 0;
            ++it;
            continue;
        }
        // Gone. To the flower whose pickup claimed it this frame, if one did;
        // otherwise it timed out where it lay and spins out instead.
        DyingDrop drop = it->second;
        drop.takerNetId = it->second.pendingTakerNetId;
        drop.pendingTakerNetId = 0;
        drop.ageSeconds = 0;
        if (dyingDrops_.size() < kMaxDyingDrops) dyingDrops_.push_back(drop);
        dropSpawns_.erase(it->first);
        it = knownDrops_.erase(it);
    }

    // --- the high-rarity shimmer -----------------------------------------
    //
    // A drop's is a steady stream at florr's 50 a second, so the rate is the
    // same at 60 Hz and at 144; a frame that stalled owes at most a quarter of
    // a second's grains (florr catches up 300 ms). A petal's glint is the
    // browser build's roll, once per drawn frame at 60 Hz -- so the chance is
    // scaled by how long the frame was, for the same reason.
    const double sinceLast = clamp(nowSeconds_ - lastIngestSeconds_, 0.0, 0.25);
    lastIngestSeconds_ = nowSeconds_;
    if (sinceLast <= 0.0) return;
    const double since = nowSeconds_ - sinceLast;
    const double chance = clamp(kSparkleChance * sinceLast * kFramesPerSecond, 0.0, 1.0);
    for (const auto& entry : view.entities()) {
        const RemoteEntity& entity = entry.second;
        if (!sparklingRarity(entity.rarity)) continue;

        if (entity.kind == net::EntityKind::Drop) {
            for (int i = grainsDue(entity.netId, since, nowSeconds_); i > 0; --i) {
                pushDropGrain(entity.position, entity.rarity, kDropShimmerBudget);
            }
            continue;
        }

        if (entity.kind != net::EntityKind::Petal || hiddenByOptions(entity)) continue;
        if (randomUnit() >= chance) continue;
        pushSparkle(entity.position, entity.rarity, kSparkleCount, 0.5, 0.5, 2000.0, 1000.0, 1.0,
                    2.0, kSparkleLifeSeconds);
    }
}

void WorldRenderer::update(double dt) {
    nowSeconds_ += dt;
    for (auto it = hitFlashes_.begin(); it != hitFlashes_.end();) {
        ageFlashes(it->second);
        it = it->second.empty() ? hitFlashes_.erase(it) : std::next(it);
    }
    for (std::vector<HitFlash>& hits : slotFlashes_) ageFlashes(hits);

    // The rituals the last frame showed still tracing: each pushes the shake
    // on its own 100 ms pace, the way florr's does every frame it draws one.
    for (const auto& [netId, traced] : ritualsTracing_) {
        double& next = ritualNextPush_[netId];
        while (nowSeconds_ >= next) {
            next = std::max(next + kRitualShakePushSeconds,
                            nowSeconds_ - kRitualShakeCatchUpSeconds);
            shakePool_ += kRitualShakePerTraced * traced;
            shakeHitSeconds_ = nowSeconds_;
            shakeHeld_ = true;
        }
    }
    ritualsTracing_.clear();
    for (auto it = ritualNextPush_.begin(); it != ritualNextPush_.end();) {
        it = ritualSeen_.count(it->first) != 0 ? std::next(it) : ritualNextPush_.erase(it);
    }

    if (shakeHeld_ && nowSeconds_ - shakeHitSeconds_ >= kShakeHoldSeconds) shakeHeld_ = false;
    easeToward(shakePool_, 0.0, kShakePoolEaseSeconds);
    easeToward(shakeLevel_, shakeHeld_ ? 1.0 : 0.0, kShakeLevelEaseSeconds);
    if (options.screenShake) {
        const double ms = nowSeconds_ * 1000.0;
        const double reach = kShakeReach * std::sin(ms * kShakeSwingPerMs) * shakeLevel_ *
                             std::min(1.0, kShakePoolGain * shakePool_);
        shakeOffset_ = {std::cos(ms * kShakeTurnPerMs) * reach,
                        std::sin(ms * kShakeTurnPerMs) * reach};
    } else {
        shakeOffset_ = {};
    }
    for (Effect& e : effects_) {
        e.ageSeconds += dt;
        for (EffectParticle& p : e.particles) {
            p.position += p.velocity * dt;
            p.lifeSeconds -= dt;
        }
    }
    effects_.erase(std::remove_if(effects_.begin(), effects_.end(),
                                  [](const Effect& e) { return e.ageSeconds >= e.lifeSeconds; }),
                   effects_.end());

    for (LightningBolt& bolt : bolts_) bolt.ageSeconds += dt;
    bolts_.erase(std::remove_if(bolts_.begin(), bolts_.end(),
                                [](const LightningBolt& b) {
                                    return b.ageSeconds >= kLightningLifeSeconds;
                                }),
                 bolts_.end());

    stepGrains(dropSparkles_, dt);

    for (auto& entry : dropSpawns_) entry.second.ageSeconds += dt;
    for (auto it = dropSpawns_.begin(); it != dropSpawns_.end();) {
        it = it->second.ageSeconds >= kDropSpawnSeconds ? dropSpawns_.erase(it) : std::next(it);
    }
    for (DyingDrop& drop : dyingDrops_) drop.ageSeconds += dt;
    dyingDrops_.erase(std::remove_if(dyingDrops_.begin(), dyingDrops_.end(),
                                     [](const DyingDrop& d) {
                                         return d.ageSeconds >= (d.takerNetId != 0
                                                                     ? kDropPickupSeconds
                                                                     : kDropDespawnSeconds);
                                     }),
                      dyingDrops_.end());

    for (DyingPetal& petal : dyingPetals_) petal.ageSeconds += dt;
    dyingPetals_.erase(std::remove_if(dyingPetals_.begin(), dyingPetals_.end(),
                                      [](const DyingPetal& p) {
                                          return p.ageSeconds >= kPetalDeathSeconds;
                                      }),
                       dyingPetals_.end());

    for (DyingMob& mob : dying_) mob.ageSeconds += dt;
    dying_.erase(std::remove_if(dying_.begin(), dying_.end(),
                                [](const DyingMob& m) {
                                    return m.ageSeconds >= kDeathAnimationSeconds;
                                }),
                 dying_.end());

    // A target that left view mid-throttle would otherwise keep its bucket for
    // the session. Long past the window nothing more can arrive for it, and
    // anything still pending is under 100 ms of damage on something that has
    // stopped being hit.
    constexpr double kBucketIdleSeconds = 5.0;
    for (auto it = damageTextAt_.begin(); it != damageTextAt_.end();) {
        if (nowSeconds_ - it->second > kBucketIdleSeconds) {
            damagePending_.erase(it->first);
            it = damageTextAt_.erase(it);
        } else {
            ++it;
        }
    }

    for (auto it = dummyDamage_.begin(); it != dummyDamage_.end();) {
        std::deque<std::pair<double, double>>& log = it->second;
        while (!log.empty() && nowSeconds_ - log.front().first > kDpsWindowSeconds) {
            log.pop_front();
        }
        if (log.empty()) {
            it = dummyDamage_.erase(it);
        } else {
            ++it;
        }
    }

    // Shadows exist only to give a Killed event something to animate, and a
    // mob that walked out of view will never produce one. Clearing wholesale
    // past the cap costs at worst one frame of death animations.
    if (mobShadows_.size() > kMaxMobShadows) mobShadows_.clear();
    if (mobEyes_.size() > kMaxMobShadows) mobEyes_.clear();
    if (mobPaces_.size() > kMaxMobShadows) mobPaces_.clear();
}

void WorldRenderer::foldHit(std::vector<HitFlash>& hits, double share) {
    if (hits.empty() || hits.back().atSeconds >= 0.0) {
        if (hits.size() >= kMaxHitFlashes) hits.erase(hits.begin());
        hits.emplace_back();
    }
    HitFlash& hit = hits.back();
    hit.share = std::min(1.0, hit.share + clamp(share, 0.0, 1.0));
    hit.intensity =
        static_cast<float>(clamp(std::pow(hit.share, kHitFlashExponent), kHitFlashFloor, 1.0));
}

void WorldRenderer::ageFlashes(std::vector<HitFlash>& hits) const {
    for (HitFlash& hit : hits) {
        if (hit.atSeconds < 0.0) hit.atSeconds = nowSeconds_;
    }
    hits.erase(std::remove_if(hits.begin(), hits.end(),
                              [this](const HitFlash& hit) {
                                  return nowSeconds_ - hit.atSeconds >= kHitFlashSeconds;
                              }),
               hits.end());
}

Color WorldRenderer::hitTint(std::uint32_t netId) const {
    const auto found = hitFlashes_.find(netId);
    if (found == hitFlashes_.end()) return Color{0, 0, 0, 0};
    return compositeFlashes(found->second);
}

Color WorldRenderer::slotHitTint(int slot) const {
    if (slot < 0 || slot >= kLoadoutActiveSlots) return Color{0, 0, 0, 0};
    return compositeFlashes(slotFlashes_[static_cast<std::size_t>(slot)]);
}

Color WorldRenderer::compositeFlashes(const std::vector<HitFlash>& hits) const {
    // Composited in bytes, cut back to a byte after every hit, in float, as
    // florr does it: each hit is a premultiplied colour laid OVER the ones
    // before it.
    const auto over = [](std::uint8_t under, std::uint8_t channel, float alpha) {
        const float add = static_cast<std::uint8_t>(static_cast<int>(channel * alpha)) / 255.0f;
        const float out = (under / 255.0f * (1.0f - alpha) + add) * 255.0f;
        return static_cast<std::uint8_t>(std::clamp(out, 0.0f, 255.0f));
    };
    Color tint{0, 0, 0, 0};
    for (const HitFlash& hit : hits) {
        // Not stamped yet: ingested since the last update, so it is new.
        const double age = hit.atSeconds < 0.0 ? 0.0 : nowSeconds_ - hit.atSeconds;
        if (age >= kHitFlashSeconds) continue;
        const float left = static_cast<float>((kHitFlashSeconds - age) / kHitFlashSeconds);
        const float alpha =
            static_cast<std::uint8_t>(static_cast<int>(left * hit.intensity * 255.0f)) / 255.0f;
        const bool white = left >= kHitFlashWhiteFrom;
        tint.r = over(tint.r, 255, alpha);
        tint.g = over(tint.g, white ? 255 : 0, alpha);
        tint.b = over(tint.b, white ? 255 : 0, alpha);
        tint.a = over(tint.a, 255, alpha);
    }
    // Premultiplied, so dimming it is scaling every channel alike.
    constexpr int kMaxAlpha = static_cast<int>(kHitFlashMaxAlpha * 255.0);
    if (tint.a > kMaxAlpha) {
        const float scale = static_cast<float>(kMaxAlpha) / static_cast<float>(tint.a);
        const auto dim = [scale](std::uint8_t channel) {
            return static_cast<std::uint8_t>(static_cast<int>(channel * scale + 0.5f));
        };
        tint = Color{dim(tint.r), dim(tint.g), dim(tint.b), static_cast<std::uint8_t>(kMaxAlpha)};
    }
    return tint;
}

} // namespace flix
