#pragma once
// The broadphase: a uniform bucket grid, rebuilt from scratch every tick.
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

#include <cstddef>
#include <cstdint>
#include <vector>

#include "shared/core/entity.h"
#include "shared/core/types.h"
#include "shared/game/constants.h"

namespace flix {

class SpatialGrid {
public:
    /// A petal ring is about 200 units across and a mob's aggro range 400 to
    /// 800, so at 600 the common query touches four cells and the widest one
    /// nine. Smaller cells shrink the candidate list but multiply the bucket
    /// count, and the whole grid is walked on wrap-around.
    static constexpr double kDefaultCellSize = 600.0;

    /// The grid covers `size` units from `origin`. One grid per REGION: the
    /// arena sits far outside the overworld, and a position outside the
    /// configured bounds is clamped into the border cells rather than dropped,
    /// so a single grid spanning both would make arena entities collide with
    /// whatever sits at the overworld's edge.
    explicit SpatialGrid(double cellSize = kDefaultCellSize,
                         Vec2 origin = Vec2{0.0, 0.0},
                         Vec2 size = Vec2{kWorldSize, kWorldSize});

    /// Retires every bucket in O(1) by bumping an epoch. The bucket vectors
    /// keep their capacity, which is what makes the steady-state rebuild
    /// allocation-free.
    void clear();

    /// Files `e` under every cell its bounding circle touches.
    ///
    /// Fat insertion, deliberately: filing a boss only under its centre cell
    /// makes it invisible to a query that overlaps nothing but its edge, and
    /// that bug looks like "the big mob has no hitbox on its left side".
    void insert(Entity e, Vec2 position, double radius = 0.0);

    /// Candidates within `radius` of `center`. `out` is cleared and refilled;
    /// hand back the same vector every tick and the query never allocates.
    void query(Vec2 center, double radius, std::vector<Entity>& out) const;

    void queryRect(Vec2 min, Vec2 max, std::vector<Entity>& out) const;
    void queryRect(const Rect& area, std::vector<Entity>& out) const;

    /// Entities inserted since the last clear. An entity spanning several
    /// cells counts once.
    std::size_t size() const { return inserted_; }
    bool empty() const { return inserted_ == 0; }

    int cols() const { return cols_; }
    int rows() const { return rows_; }
    double cellSize() const { return cellSize_; }
    Vec2 origin() const { return origin_; }

    /// Total slots reserved across every bucket. Only tests care: it is how
    /// they assert that a steady-state rebuild stopped allocating.
    std::size_t reservedEntries() const;

    /// Cell coordinates for a world point, clamped into the grid.
    int cellX(double worldX) const { return cellIndex(worldX - origin_.x, invCellSize_, cols_); }
    int cellY(double worldY) const { return cellIndex(worldY - origin_.y, invCellSize_, rows_); }

private:
    /// Hard cap per axis. A caller asking for a one-unit cell over the whole
    /// world would otherwise ask for 3.6 billion buckets.
    static constexpr int kMaxAxisCells = 512;

    static int cellIndex(double offset, double invCellSize, int axisCells);

    std::size_t bucketAt(int cx, int cy) const {
        return static_cast<std::size_t>(cy) * static_cast<std::size_t>(cols_) + static_cast<std::size_t>(cx);
    }

    double cellSize_ = kDefaultCellSize;
    double invCellSize_ = 1.0 / kDefaultCellSize;
    Vec2 origin_;
    int cols_ = 1;
    int rows_ = 1;

    std::vector<std::vector<Entity>> buckets_;
    /// Which epoch each bucket was last written in. A bucket whose epoch is
    /// stale still holds last tick's entities; readers skip it and the next
    /// insert clears it. That is the whole trick behind an O(1) clear().
    std::vector<std::uint32_t> bucketEpoch_;
    std::uint32_t epoch_ = 1;
    std::size_t inserted_ = 0;

    /// Per-entity-index stamp, so a query can drop the duplicates that fat
    /// insertion creates without allocating a set. Keyed by entity INDEX
    /// rather than by handle: an index names at most one live entity, and the
    /// grid only ever holds live ones.
    ///
    /// Mutable because it is scratch space for a logically const read, which
    /// also means a single grid cannot be queried from two threads at once.
    mutable std::vector<std::uint32_t> stamp_;
    mutable std::uint32_t queryEpoch_ = 0;
};

} // namespace flix
