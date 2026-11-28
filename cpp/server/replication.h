#pragma once
// Per-client snapshot construction.
//
// Each client sees only what is near it, and is told about an entity in three
// stages: a SPAWN record carrying the immutable facts (kind, type, rarity,
// name), then per-tick UPDATE records carrying only the fields that changed,
// then a REMOVE when it leaves view or dies.
//
// Removals are derived, not evented: every tick the replicator diffs what the
// client is believed to know against what is actually in view. There is no
// one-shot "this entity went away" message that can be dropped and leave a
// permanent ghost -- the diff regenerates the removal for as long as the
// discrepancy exists.

#include <algorithm>
#include <cstddef>
#include <cstdint>
#include <optional>
#include <string>
#include <unordered_map>
#include <vector>

#include "shared/core/world.h"
#include "shared/game/components.h"
#include "shared/net/bytebuffer.h"
#include "shared/net/protocol.h"

namespace flix {


/// Allocates the ids entities are known by on the wire.
///
/// Separate from Entity because Entity encodes a slot that gets recycled: a
/// client that has not yet processed a removal would otherwise apply an update
/// meant for a brand-new entity to the corpse of the old one. Net ids are
/// monotonic and never reused within a server's lifetime.
class NetIdAllocator {
public:
    std::uint32_t next() { return ++counter_; }
    /// Counts on from `base`. Two servers of a sharded game must never hand
    /// out one id between them: a client's chat bubbles name a flower by it
    /// whichever server that flower is on.
    void startFrom(std::uint32_t base) { counter_ = base; }

private:
    std::uint32_t counter_ = 0;
};

/// What one client is believed to already know.
class ClientView {
public:
    /// The last values sent for one entity, so the next tick can send only
    /// what actually changed.
    struct Tracked {
        Vec2 position;
        double angle = 0;
        /// The last health fraction SENT, and -1 until one has been.
        ///
        /// Held as the value quantized at its wire width
        /// (net::quantizeHealthFraction) -- exactly what the client decodes --
        /// and compared for exact equality against the next one, so anything a
        /// hit changes about a mob's pool that survives the wire is a change the
        /// client must see. A threshold here used to be the bug -- at 1/255 a
        /// petal taking a millionth of an apex mob read as "unchanged" and the
        /// bar sat still through the whole fight.
        double healthFraction = -1;
        double radius = -1;
        std::uint8_t state = 0xFF;    ///< 0xFF is not a valid state, forcing a first send
        std::uint8_t faceFlags = 0xFF;
        std::uint16_t equipFlags = 0xFFFF;
        std::uint32_t renderFlags = 0xFFFFFFFFu;
        std::uint16_t level = 0;      ///< 0 is not a valid level, forcing a first send
        std::uint8_t bestRarity = 0xFF;
        std::uint32_t arenaScore = 0;
        std::uint8_t shield = 0;
        /// A hash of the equipped skin id, not the id itself.
        ///
        /// One Tracked exists per entity per viewer -- mobs, petals, drops and
        /// all -- so a std::string here would be 32 bytes on every one of them
        /// to describe something only players ever have. The hash is used for
        /// change detection alone; the wire always carries the real id. 0 is
        /// the hash of "", so the sentinel for "never sent" has to be
        /// something else.
        std::uint32_t skinIdHash = 0xFFFFFFFFu;
        /// The same for the guild tag.
        std::uint32_t guildTagHash = 0xFFFFFFFFu;
    };

    /// What this client is believed to hold, sorted by net id -- the order
    /// the snapshot names entities in -- so a build is one merge walk over it
    /// and the in-view list rather than a hash lookup per entity per viewer.
    struct Entry {
        std::uint32_t netId;
        Tracked value;
    };
    std::vector<Entry> tracked;

    /// The tracked entry for `netId`, or null.
    const Tracked* find(std::uint32_t netId) const {
        const auto it = std::lower_bound(
            tracked.begin(), tracked.end(), netId,
            [](const Entry& entry, std::uint32_t id) { return entry.netId < id; });
        return it != tracked.end() && it->netId == netId ? &it->value : nullptr;
    }

    /// The viewer's own figures as last sent (net::SelfFields), at the width
    /// they went out in. Meaningless until `selfSent`.
    struct SelfSent {
        float health = 0, maxHealth = 0;
        float mana = 0, maxMana = 0;
        double totalXp = 0;
        std::uint16_t level = 0;
        double stars = 0;
    };
    SelfSent self;
    bool selfSent = false;

    /// Cleared when the client re-joins, so a fresh session re-learns the world
    /// rather than inheriting a stale belief about it.
    void reset() {
        tracked.clear();
        selfSent = false;
    }
};

/// Quantisation thresholds below which a field is considered unchanged.
///
/// These are the whole reason a snapshot is small. A mob drifting a hundredth
/// of a unit does not need eight bytes spent on it, and no player can see the
/// difference. Set them just under what a pixel represents at normal zoom.
/// Health is deliberately absent: it is compared exactly (see
/// ClientView::Tracked::healthFraction) rather than against a threshold,
/// because a mob's bar is read as a proportion of a pool that spans nine
/// orders of magnitude across the tier ladder, and any fixed fraction of it is
/// enormous at the top.
struct ReplicationTolerances {
    double position = 0.05;     ///< world units
    double angle = 0.01;        ///< radians, ~0.6 degrees
    double radius = 0.05;
};

/// One transient thing that happened this tick, for effects the client plays
/// without the server streaming per-frame animation state.
struct WireEvent {
    net::EventKind kind = net::EventKind::Damage;
    std::uint32_t netId = 0;
    std::uint32_t otherNetId = 0;
    double amount = 0;
    Vec2 position;
    /// The space `position` is in. A positional event is only sent to viewers
    /// in the same realm: a damage number in the maze means nothing to a
    /// flower in the overworld whose window happens to cover the same numbers.
    Realm realm = Realm::Overworld;
    double radius = 0;
    std::uint8_t flag = 0;

    /// Damage only, and never on the wire as such: the flower the hit is
    /// credited to (CombatSystem::creditedPlayer) and its connection, 0 for a
    /// bot. The replicator turns them into net::DamageByViewer for the one
    /// viewer they belong to -- by connection as well as by body, so a hit
    /// from the parked half of a split still reads as the splitter's own.
    Entity dealtBy = NULL_ENTITY;
    net::ConnectionId dealtByConnection = 0;

    /// Damage only, and never on the wire: the body `netId` names. A
    /// squadmate's hits reach the viewer however far away they land, as the
    /// squadmate itself does (Replicator::Frame::alwaysVisible), so the party
    /// HUD's avatar flashes with every one of them.
    Entity struck = NULL_ENTITY;

    /// Damage only, and never on the wire as such: the flower whose loadout
    /// slot `wornSlot` holds the struck petal, NULL_ENTITY for anything that
    /// is not a worn petal. That flower's bar flashes the slot's tile, so on
    /// ITS wire `otherNetId` is written as 1 + `wornSlot` (see
    /// net::DamageFlashOnly), and the hit reaches it wherever the petal is.
    Entity wornBy = NULL_ENTITY;
    std::uint8_t wornSlot = 0;
    /// Sent to `wornBy` alone: the blow that broke the petal, which leaves
    /// nothing in the world to flash but the tile it leaves behind.
    bool wearerOnly = false;

    /// Lightning only: where each bolt ends, in world space. Empty for every
    /// other kind, and the only variable-length thing on the event wire.
    std::vector<Vec2> points;

    /// Only clients in the same realm whose streamed box contains `position`
    /// are sent the event; every EventQueue factory sets it. A damage number
    /// on the far side of the map is bytes nobody will see.
    bool positional = false;
};

/// Collects the tick's events, then hands each client the ones it can see.
class EventQueue {
public:
    void clear() { events_.clear(); }

    /// `flags` is a net::DamageEventFlags mask. Poison is called out on the
    /// wire because the client colours and offsets a tick differently from a
    /// petal hit, and only the server knows which one landed. `dealtBy` and
    /// `dealtByConnection` name the flower behind the hit, if any; see
    /// WireEvent::dealtBy. `share` is what the hit took as a fraction of the
    /// victim's max health, which is how bright the client flashes it.
    /// `struck` is the body `netId` names; see WireEvent::struck. Returns the
    /// event, for the fields only some hits carry (WireEvent::wornBy).
    WireEvent& damage(std::uint32_t netId, double amount, Vec2 at, Realm realm,
                      std::uint8_t flags = 0, Entity dealtBy = NULL_ENTITY,
                      net::ConnectionId dealtByConnection = 0, double share = 0,
                      Entity struck = NULL_ENTITY) {
        WireEvent e;
        e.kind = net::EventKind::Damage;
        e.netId = netId;
        e.amount = amount;
        // A Damage event has no reach, so its radius slot carries the share
        // (see net::EventKind::Damage).
        e.radius = share;
        e.position = at;
        e.realm = realm;
        e.flag = flags;
        e.dealtBy = dealtBy;
        e.dealtByConnection = dealtByConnection;
        e.struck = struck;
        e.positional = true;
        events_.push_back(e);
        return events_.back();
    }

    void killed(std::uint32_t netId, Vec2 at, Realm realm) {
        WireEvent e;
        e.kind = net::EventKind::Killed;
        e.netId = netId;
        e.position = at;
        e.realm = realm;
        e.positional = true;
        events_.push_back(e);
    }

    /// `petalIndex` and `rarity` are the drop's LOOK, carried so the client can
    /// play the pickup for an item it never held: magnetism is a pickup radius,
    /// and loot that lands inside it is collected on the tick it spawned --
    /// before any snapshot has carried the entity. See net::EventKind::PickedUp.
    void pickedUp(std::uint32_t dropNetId, std::uint32_t byNetId, Vec2 at, Realm realm,
                  std::uint16_t petalIndex, Rarity rarity) {
        WireEvent e;
        e.kind = net::EventKind::PickedUp;
        e.netId = dropNetId;
        e.otherNetId = byNetId;
        e.amount = static_cast<double>(petalIndex);
        e.flag = static_cast<std::uint8_t>(rarityIndex(rarity));
        e.position = at;
        e.realm = realm;
        e.positional = true;
        events_.push_back(e);
    }

    /// A petal's blast: `radius` is its reach, which is what the client
    /// throws the smoke and sparks out to. See net::EventKind::Explosion.
    void explosion(Vec2 at, double radius, Realm realm) {
        WireEvent e;
        e.kind = net::EventKind::Explosion;
        e.position = at;
        e.radius = radius;
        e.realm = realm;
        e.positional = true;
        events_.push_back(e);
    }

    /// `targets` is where the bolts end -- whatever the strike hit, read
    /// before the damage lands -- and the strike is drawn to the
    /// net::kMaxLightningTargets of them nearest `at` when there are more than
    /// fit. Nearest, not first: a plain truncation would take whatever order
    /// the archetypes happen to hold, which is a direction rather than a disc
    /// -- the browser build shipped that bug, and every bolt in a dense pile
    /// fanned the same way. Only the drawing is trimmed; what the strike
    /// damages is the caller's own list. `flag` rides the event's flag byte:
    /// net::DamageGlitch draws the bolts green.
    void lightning(Vec2 at, double radius, Realm realm, std::vector<Vec2> targets,
                   std::uint8_t flag = 0) {
        if (targets.size() > net::kMaxLightningTargets) {
            const auto cap = static_cast<std::ptrdiff_t>(net::kMaxLightningTargets);
            std::partial_sort(targets.begin(), targets.begin() + cap, targets.end(),
                              [at](const Vec2& a, const Vec2& b) {
                                  return distanceSq(a, at) < distanceSq(b, at);
                              });
            targets.resize(net::kMaxLightningTargets);
        }
        WireEvent e;
        e.kind = net::EventKind::Lightning;
        e.position = at;
        e.radius = radius;
        e.flag = flag;
        e.realm = realm;
        e.points = std::move(targets);
        e.positional = true;
        events_.push_back(std::move(e));
    }

    const std::vector<WireEvent>& events() const { return events_; }

private:
    std::vector<WireEvent> events_;
};

/// The player-specific flag families that define the flower sprite. Keeping
/// these separate from EntityState lets ordinary entities retain their compact
/// generic state while players carry the sprite's own flag families, as the
/// TypeScript renderer they were ported from drew them.
struct PlayerVisualState {
    std::uint8_t faceFlags = FaceNone;
    std::uint16_t equipFlags = EquipNone;
    std::uint32_t renderFlags = PlayerRenderNone;
    /// The plate under every flower reads its own level and tints itself with
    /// the best rarity anywhere in that flower's loadout, so both belong to
    /// the viewer of a player rather than to the player being viewed.
    std::uint16_t level = 1;
    Rarity bestRarity = Rarity::Common;
    /// The arena leaderboard's number; zero for anyone not in the ring.
    std::uint32_t arenaScore = 0;
    /// The live shield, as 255ths of this flower's MAX health -- which is the
    /// scale the bar it is drawn on is measured in. Zero when none is up, so
    /// a flower with no Shell in its loadout sends nothing but zeroes here.
    std::uint8_t shield = 0;
    /// Borrowed from PlayerVisuals, never owned: this is rebuilt for every
    /// player in every viewer's snapshot, and copying a ~20-character id that
    /// many times a second is a heap allocation per player per viewer for a
    /// string that has not changed since login. Null is "no custom skin", and
    /// the pointee outlives the snapshot it is written into -- the world is
    /// not mutated while one is being built.
    const std::string* equippedSkinId = nullptr;
    /// Borrowed likewise. Null is "in no guild".
    const std::string* guildTag = nullptr;
};

/// The id a visual state names, or "" when it names none.
inline const std::string& skinIdOf(const PlayerVisualState& visuals) {
    static const std::string none;
    return visuals.equippedSkinId ? *visuals.equippedSkinId : none;
}

/// The guild tag a visual state carries, or "" when it carries none.
inline const std::string& guildTagOf(const PlayerVisualState& visuals) {
    static const std::string none;
    return visuals.guildTag ? *visuals.guildTag : none;
}

/// Builds the Snapshot message for one client.
class Replicator {
public:
    /// Everything the snapshot needs that is not in the world.
    struct Frame {
        std::uint32_t tick = 0;
        /// Counts SNAPSHOTS, not ticks: the wire runs slower than the
        /// simulation and on its own clock, so a cadence expressed in ticks
        /// would land unevenly on the frames that actually go out.
        std::uint32_t snapshotIndex = 0;
        double nowMillis = 0;
        /// Added to nowMillis for the stamp on the wire, which is when the bodies
        /// were moved to rather than when that was: GameServer::motionLeadMillis_.
        double motionLeadMillis = 0;
        const EventQueue* events = nullptr;
        /// Bodies streamed to this client however far away they are.
        ///
        /// The viewer's squadmates, and nothing else: the reference's own
        /// visibility test lets a squad member through the viewport box, which
        /// is what makes the party HUD and the pink minimap dots work at a
        /// distance. Null when the viewer squads alone, which is the ordinary
        /// case and costs the gather nothing.
        const std::vector<Entity>* alwaysVisible = nullptr;
        /// The window to cull to, when it is not the viewer body's own claim
        /// (PlayerLocation::viewport). Set for an admin steering another
        /// player's flower: the stream is built around THAT flower, but in the
        /// box the admin's own client reported -- the steered player's claim is
        /// their own screen's, and it keeps culling their own stream.
        std::optional<Vec2> viewport;
    };

    /// Appends a complete Snapshot payload (message id included) to `out`.
    ///
    /// `viewer` must be a live player entity. `view` is mutated to record what
    /// this snapshot told the client.
    void build(World& world, Entity viewer, ClientView& view, const Frame& frame, ByteWriter& out);

    /// Brackets one snapshot pass -- the builds for every client on the same
    /// tick -- so the world's replicated entities are listed once for all of
    /// them instead of once per client. Between the two the world must not
    /// change: nothing a build does touches it. A build outside a pass lists
    /// them itself, through the same code.
    void beginPass(World& world, double nowMillis);
    void endPass() { passIndexed_ = false; }

    ReplicationTolerances tolerances;

    /// Per-AXIS half-extent of the replicated region, as a multiple of the
    /// client's own reported viewport.
    ///
    /// Two decisions live in this one number. It is a RECTANGLE rather than a
    /// circle, because the screen is one and a radius that covers the corners
    /// over-serves the edges; and it is two viewports rather than half of one,
    /// because the reference streams a box four screens wide so an entity is
    /// known long before it is drawn. Anything tighter pops mobs in at the
    /// screen edge as soon as the player zooms out or enlarges the window.
    ///
    /// Exact up to the default screen. On a bigger one (a camera petal) the
    /// margin past the drawn half stops growing at the default screen's, so
    /// the box is everything drawn plus the same distance a default screen
    /// gets. Without that cap, eternal antennae's tenfold view would stream the
    /// whole map.
    double viewportReach = 2.0;

    /// How far out an entity still gets an update EVERY snapshot, as a
    /// multiple of the viewport per axis.
    ///
    /// The streamed box is four screens across (viewportReach above), and the
    /// screen inside it is one -- so fifteen sixteenths of everything streamed
    /// is, at any moment, being described to a client that is not drawing it.
    /// Those entities are streamed so they are KNOWN before they are drawn,
    /// which is a statement about existence, not about being current to the
    /// tick: a mob two screens away can be a tenth of a second stale without a
    /// single pixel being wrong.
    ///
    /// The viewport a client reports is the world rectangle it DRAWS -- it
    /// divides by its own zoom before sending, so a wide loadout lens widens
    /// this box rather than seeing past it. The drawn rectangle is therefore
    /// 0.5 of it per axis, and 0.75 leaves a quarter-screen margin all round:
    /// 640 world units at 1440p, which the fastest thing in the game takes two
    /// seconds to cross and the far band is never more than a fifth of a
    /// second stale. Nothing reaches the drawn edge without having been at
    /// full rate for a long while first. That holds because the box is tested
    /// against the edge of an entity's body, not its centre: a big mob is
    /// wider than the margin. Its margin is capped the same way viewportReach's
    /// is, and the drawn half is never capped.
    double nearReach = 0.75;

    /// One snapshot in this many carries the far band. Staggered by net id, so
    /// the band's cost is spread evenly over the snapshots rather than landing
    /// on every sixth one as a spike.
    int farSnapshotStride = 6;

    /// Ceiling on entities in one snapshot.
    ///
    /// A frame-size backstop, NOT a cull rule: the reference caps nothing, and
    /// this sits far above what a four-screen box ever holds, so the nearest-
    /// wins tiebreak below should never actually fire in play. It exists only
    /// so a pathological world cannot ask the server to build a frame past the
    /// transport's limit.
    std::size_t maxEntities = 8000;

private:
    struct Candidate {
        Entity entity;
        std::uint32_t netId;
        double distanceSq;
        /// Where the entity sits in index_, so its Facts are found without a
        /// lookup.
        std::uint32_t at;
    };

    /// One replicated entity, as the gather reads it: everything the in-view
    /// test needs without a component lookup. Sorted by realm, then net id,
    /// so a client scans only its own realm's run, and that run is already in
    /// the net id order the snapshot is written in.
    struct Indexed {
        Entity entity;
        Vec2 position;
        std::uint32_t netId;
        Realm realm;
        bool drop;     ///< carries a DropItem, whose claims are per viewer
        bool market;   ///< a market NPC, streamed from any distance
    };
    void indexWorld(World& world, double nowMillis);

    /// What an update or spawn record says about an entity that does not
    /// depend on who is looking: the same for every viewer in a pass. Worked
    /// out the first time any viewer of the pass needs it -- rather than once
    /// per viewer, which with a crowd of flowers in one place was most of the
    /// pass -- and never for an entity nobody sees. Parallel to index_.
    struct Facts {
        bool ready = false;
        bool hasHealth = false;
        bool healthWide = false;
        bool hasBody = false;
        net::EntityKind kind = net::EntityKind::Mob;
        std::uint8_t state = 0;
        double angle = 0;
        double radius = 10;         ///< replicatedRadius: what a spawn says
        double bodyRadius = 0;      ///< the Body's, when hasBody: what an update compares
        double healthFraction = 1;  ///< raw, as written
        double healthSent = -1;     ///< quantized at its width, as compared
        PlayerVisualState visuals;
        std::uint32_t skinHash = 0;
        std::uint32_t guildTagHash = 0;
    };
    const Facts& factsOf(World& world, std::uint32_t at);

    /// What a SPAWN record says about an entity that does not depend on who
    /// is looking, beside Facts and worked out the same way: the first time
    /// any viewer of the pass spawns it. A spawn used to look every one of
    /// these up again per viewer, and in a crowd every viewer spawns the same
    /// fresh volleys of shots each snapshot.
    struct SpawnFacts {
        bool ready = false;
        net::EntityKind kind = net::EntityKind::Mob;
        std::uint16_t typeIndex = 0;
        Rarity rarity = Rarity::Common;
        std::uint8_t spawnFlags = 0;
        /// ownershipFlags' inputs: whether anyone owns it, the player who
        /// does, SpawnIsPet when a pet fired it, and that player's connection.
        bool owned = false;
        Entity ownerPlayer = NULL_ENTITY;
        std::uint8_t ownerFlags = 0;
        bool ownerHasAccount = false;
        net::ConnectionId ownerConnection = 0;
        /// The entity's own name, or null for none (SpawnHasName). Borrowed
        /// from its PlayerAccount, which nothing changes during a pass.
        const std::string* username = nullptr;
        /// A flower's account name (PlayerAccount::handle), or null for none.
        const std::string* handle = nullptr;
        /// A petal's flower or a ring seed's mob, by net id; 0 for none.
        std::uint32_t petalOwnerNetId = 0;
        /// An NPC's recipe.
        std::uint8_t npcRecipe = 0;
    };
    const SpawnFacts& spawnFactsOf(World& world, std::uint32_t at);
    std::vector<SpawnFacts> spawnFacts_;

    std::vector<Indexed> index_;
    /// indexWorld()'s sort scratch, kept for its capacity.
    std::vector<std::uint64_t> sortKeys_;
    std::vector<Indexed> sorted_;
    std::vector<Facts> facts_;
    double indexedAtMillis_ = 0;
    bool passIndexed_ = false;
    std::vector<Candidate> candidates_;
    std::vector<std::uint32_t> removals_;
    /// The view's next tracked list, built beside the old one and swapped in.
    std::vector<ClientView::Entry> nextTracked_;
};

/// Derives the EntityState bits the client draws from. Called once per
/// replicated entity per tick.
std::uint8_t computeEntityState(World& world, Entity e, double nowMillis);

PlayerVisualState computePlayerVisuals(World& world, Entity e, double nowMillis);

} // namespace flix
