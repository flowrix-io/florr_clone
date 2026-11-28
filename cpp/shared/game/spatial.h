#pragma once
// The broadphase: a uniform bucket grid per realm, rebuilt from scratch every
// tick.
//
// Everything that asks "what is near me" -- contact damage, petal hits,
// projectile tests, mob aggro, drop pickup -- asks it here first. Rebuilding
// beats maintaining: in a world where nearly every entity moves every tick, an
// incremental structure spends more time on removals and re-insertions than a
// full rebuild costs, and it can go wrong. This cannot.
//
// Results are CANDIDATES. A query returns every entity whose inserted
// footprint shares a cell with the queried region, which is a superset of the
// entities that actually overlap it; the caller does the exact test, because
// the caller is the one that knows whether it wants circles, capsules or a
// cone. What the grid guarantees is that the superset is complete and that
// nothing appears in it twice.
//
// One LAYER per realm (see realm.h). The overworld, the arena and the maze
// are separate coordinate spaces whose positions overlap numerically, so an
// entity is filed under its realm and a query names the realm it is asking
// about. A candidate list therefore never crosses realms, and no caller has
// to remember to check -- a maze mob at (3000, 3000) is simply not in the
// grid an overworld flower at (3000, 3000) queries.

#include <array>
#include <cstddef>
#include <cstdint>
#include <vector>

#include "shared/core/entity.h"
#include "shared/core/types.h"
#include "shared/game/constants.h"
#include "shared/game/realm.h"

namespace flix {

class Terrain;

class SpatialGrid {
public:
    /// A petal ring is about 200 units across and a mob's aggro range 400 to
    /// 800, so at 600 the common query touches four cells and the widest one
    /// nine. Smaller cells shrink the candidate list but multiply the bucket
    /// count, and the whole grid is walked on wrap-around.
    static constexpr double kDefaultCellSize = 600.0;

    /// Each realm's layer covers that realm's square from (0, 0). A position
    /// outside it is clamped into the border cells rather than dropped, so
    /// nothing is ever lost to the grid; it is only found by more queries than
    /// it needs to be.
    ///
    /// Every layer is born the default world's size, because the maps are not
    /// loaded yet when a World is built. sizeToRealms() below is what fits
    /// them to the maps that were actually staged; skipping it costs a query
    /// on a small map some empty cells, never a missed candidate.
    explicit SpatialGrid(double cellSize = kDefaultCellSize);

    /// Re-sizes every layer to the realm it holds, once the maps are loaded.
    ///
    /// Cheap and idempotent: a layer whose cell count did not change keeps its
    /// bucket vectors, and with them the capacity that makes the steady-state
    /// rebuild allocation-free.
    void sizeToRealms(const Terrain& terrain);

    /// Retires every bucket in O(1) by bumping an epoch. The bucket vectors
    /// keep their capacity, which is what makes the steady-state rebuild
    /// allocation-free.
    void clear();

    /// Files `e` under every cell its bounding circle touches, in its realm.
    ///
    /// Fat insertion, deliberately: filing a boss only under its centre cell
    /// makes it invisible to a query that overlaps nothing but its edge, and
    /// that bug looks like "the big mob has no hitbox on its left side".
    void insert(Entity e, Realm realm, Vec2 position, double radius = 0.0);

    /// Candidates within `radius` of `center`, in one realm. `out` is cleared
    /// and refilled; hand back the same vector every tick and the query never
    /// allocates.
    void query(Realm realm, Vec2 center, double radius, std::vector<Entity>& out) const;

    void queryRect(Realm realm, Vec2 min, Vec2 max, std::vector<Entity>& out) const;
    void queryRect(Realm realm, const Rect& area, std::vector<Entity>& out) const;

    /// Every entity whose FILED circle overlaps the disc, in one realm, each
    /// once -- the circles query() would hand back minus the ones that are
    /// nowhere near. Still candidates: a body moved since it was filed is
    /// found where it was filed, so a caller that moves bodies widens its
    /// radius by what they may have moved, as it would for query(). A non-
    /// finite filed radius always overlaps; a negative one counts as zero.
    ///
    /// For a small disc asked many times over: a projectile is a few units
    /// across, and query() hands it every petal, flower and mob in a 600-unit
    /// cell -- a hundred candidates for its one or two hits, ten thousand
    /// times a tick where the shooters stand together. Each bucket a query
    /// like this touches is split, the first time it is asked in an epoch,
    /// into kFineSplit x kFineSplit sub-cells holding the circles inline, so
    /// the test is a dense scan of a cell or two and nothing else is read.
    /// Buckets no such query reaches are never split. The order is not
    /// query()'s: a caller that wants one sorts the answer.
    void queryOverlapping(Realm realm, Vec2 center, double radius, std::vector<Entity>& out) const;

    /// Entities inserted since the last clear, across every realm. An entity
    /// spanning several cells counts once.
    std::size_t size() const { return inserted_; }
    bool empty() const { return inserted_ == 0; }

    /// The circle `e` was filed as this epoch: position and radius exactly as
    /// insert() was handed them.
    struct FiledCircle {
        Vec2 position;
        double radius = 0;
    };

    /// Where `e` was filed, or null when it was not filed this epoch -- or
    /// when anything was filed twice, after which no one circle is the answer.
    /// For a caller that would otherwise look the entity's components up only
    /// to find it far away: one dense load instead of an archetype chase. It
    /// is the position at FILING time; a caller that moves bodies after that
    /// must not trust it for those.
    const FiledCircle* filedCircle(Entity e) const {
        if (refiled_ || e == NULL_ENTITY) return nullptr;
        const std::uint32_t idx = entityIndex(e);
        if (idx >= filed_.size() || filed_[idx] != epoch_) return nullptr;
        return &filedCircles_[idx];
    }

    int cols(Realm realm) const { return layer(realm).cols; }
    int rows(Realm realm) const { return layer(realm).rows; }
    double cellSize() const { return cellSize_; }

    /// Total slots reserved across every bucket of every layer. Only tests
    /// care: it is how they assert that a steady-state rebuild stopped
    /// allocating.
    std::size_t reservedEntries() const;

    /// Cell coordinates for a point in a realm, clamped into that layer.
    int cellX(Realm realm, double x) const { return cellIndex(x, invCellSize_, layer(realm).cols); }
    int cellY(Realm realm, double y) const { return cellIndex(y, invCellSize_, layer(realm).rows); }

private:
    /// Hard cap per axis. A caller asking for a one-unit cell over the whole
    /// world would otherwise ask for 3.6 billion buckets.
    static constexpr int kMaxAxisCells = 512;

    static int cellIndex(double offset, double invCellSize, int axisCells);

    /// One realm's buckets.
    struct Layer {
        int cols = 1;
        int rows = 1;
        std::vector<std::vector<Entity>> buckets;
        /// Which epoch each bucket was last written in. A bucket whose epoch
        /// is stale still holds last tick's entities; readers skip it and the
        /// next insert clears it. That is the whole trick behind an O(1)
        /// clear().
        std::vector<std::uint32_t> bucketEpoch;
        /// queryOverlapping()'s split of each bucket: which epoch it was split
        /// in (0 for not this one, and reset by an insert into the bucket),
        /// and where in fine_ the split is. Scratch for a const read, as
        /// stamp_ is.
        mutable std::vector<std::uint32_t> fineEpoch;
        mutable std::vector<std::uint32_t> fineSlot;

        std::size_t bucketAt(int cx, int cy) const {
            return static_cast<std::size_t>(cy) * static_cast<std::size_t>(cols) +
                   static_cast<std::size_t>(cx);
        }
    };

    Layer& layer(Realm realm) { return layers_[realmIndex(realm)]; }
    const Layer& layer(Realm realm) const { return layers_[realmIndex(realm)]; }

    double cellSize_ = kDefaultCellSize;
    double invCellSize_ = 1.0 / kDefaultCellSize;
    std::array<Layer, kMaxRealms> layers_;
    std::uint32_t epoch_ = 1;
    std::size_t inserted_ = 0;

    /// Per-entity-index stamp, so a query can drop the duplicates that fat
    /// insertion creates without allocating a set. Keyed by entity INDEX
    /// rather than by handle: an index names at most one live entity, and the
    /// grid only ever holds live ones. Shared by every layer -- a query only
    /// ever walks one.
    ///
    /// Mutable because it is scratch space for a logically const read, which
    /// also means a single grid cannot be queried from two threads at once.
    mutable std::vector<std::uint32_t> stamp_;
    mutable std::uint32_t queryEpoch_ = 0;

    /// The epoch each entity INDEX was last filed in, and whether any entity
    /// has been filed twice this epoch. While none has, no bucket holds an
    /// entity twice, and a query that fits in one cell is that bucket as it
    /// stands -- copied whole, with no stamps to write. Most queries are: a
    /// body's reach is far smaller than a cell, and contact, separation and
    /// petal attraction ask one for every body in the world each tick.
    std::vector<std::uint32_t> filed_;
    bool refiled_ = false;
    /// Parallel to filed_: see filedCircle().
    std::vector<FiledCircle> filedCircles_;

    /// queryOverlapping()'s sub-cells: a bucket is split this many ways on
    /// each axis, 75 units at the default cell, a little wider than a fast
    /// shot's whole query. Finer files a petal ring's petals under more
    /// sub-cells each and a boss under up to the square of this.
    static constexpr int kFineSplit = 8;
    static constexpr int kFineCells = kFineSplit * kFineSplit;
    struct FineEntry {
        Entity entity = NULL_ENTITY;
        Vec2 position;
        /// The filed radius as the overlap test reads it: zero for a
        /// negative one, and infinite for one that is not a number.
        double reach = 0;
    };
    /// One bucket split: sub-cell `c`'s entries are entries[start[c],
    /// start[c + 1]), sub-cells row by row, so a span of one row is one run.
    /// An entity is under every sub-cell of the bucket its circle touches.
    struct FineBucket {
        std::array<std::uint32_t, kFineCells + 1> start{};
        std::vector<FineEntry> entries;
    };
    /// Splits made this epoch, reused from one epoch to the next for their
    /// capacity: fine_[0, fineUsed_) are live.
    mutable std::vector<FineBucket> fine_;
    mutable std::size_t fineUsed_ = 0;
    mutable std::uint32_t fineEpoch_ = 0;
    const FineBucket& fineBucket(const Layer& source, std::size_t bucket, int cx, int cy) const;
    int fineIndex(double offset) const;
    static void fitFine(Layer& layer);
};

} // namespace flix
