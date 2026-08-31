#include "shared/game/spatial.h"

#include <algorithm>
#include <cmath>

namespace flr {

SpatialGrid::SpatialGrid(double cellSize, Vec2 origin, Vec2 size) : origin_(origin) {
    cellSize_ = (std::isfinite(cellSize) && cellSize > 1.0) ? cellSize : kDefaultCellSize;
    invCellSize_ = 1.0 / cellSize_;

    const double wide = std::isfinite(size.x) && size.x > 0 ? size.x : kWorldSize;
    const double tall = std::isfinite(size.y) && size.y > 0 ? size.y : kWorldSize;
    cols_ = clamp(static_cast<int>(std::ceil(std::min(wide, 1e9) * invCellSize_)), 1, kMaxAxisCells);
    rows_ = clamp(static_cast<int>(std::ceil(std::min(tall, 1e9) * invCellSize_)), 1, kMaxAxisCells);

    const std::size_t cells = static_cast<std::size_t>(cols_) * static_cast<std::size_t>(rows_);
    buckets_.resize(cells);
    bucketEpoch_.assign(cells, 0);
}

int SpatialGrid::cellIndex(double offset, double invCellSize, int axisCells) {
    const double c = std::floor(offset * invCellSize);
    // Written as failed comparisons so NaN lands in cell 0 instead of taking
    // an undefined trip through the cast.
    if (!(c > 0.0)) return 0;
    if (!(c < static_cast<double>(axisCells))) return axisCells - 1;
    return static_cast<int>(c);
}

void SpatialGrid::clear() {
    inserted_ = 0;
    if (++epoch_ == 0) {
        // Once every four billion ticks the epoch wraps onto the value stale
        // buckets already carry, so retire them all for real. Never hit in a
        // session; cheap enough that it does not need to be.
        std::fill(bucketEpoch_.begin(), bucketEpoch_.end(), 0);
        epoch_ = 1;
    }
}

void SpatialGrid::insert(Entity e, Vec2 position, double radius) {
    if (e == NULL_ENTITY) return;
    // A NaN position cannot be found by any query, so filing it would only
    // give a later reader a corrupt candidate to trip over.
    if (!std::isfinite(position.x) || !std::isfinite(position.y)) return;
    if (!std::isfinite(radius) || radius < 0.0) radius = 0.0;

    const std::uint32_t idx = entityIndex(e);
    if (idx >= stamp_.size()) {
        // Grown here rather than in query(), so the read path never allocates.
        stamp_.resize(std::max<std::size_t>(static_cast<std::size_t>(idx) + 1, stamp_.size() * 2), 0);
    }

    const int x0 = cellX(position.x - radius);
    const int x1 = cellX(position.x + radius);
    const int y0 = cellY(position.y - radius);
    const int y1 = cellY(position.y + radius);
    for (int cy = y0; cy <= y1; ++cy) {
        for (int cx = x0; cx <= x1; ++cx) {
            const std::size_t b = bucketAt(cx, cy);
            if (bucketEpoch_[b] != epoch_) {
                buckets_[b].clear();
                bucketEpoch_[b] = epoch_;
            }
            buckets_[b].push_back(e);
        }
    }
    ++inserted_;
}

void SpatialGrid::query(Vec2 center, double radius, std::vector<Entity>& out) const {
    if (!std::isfinite(radius) || radius < 0.0) radius = 0.0;
    queryRect(Vec2{center.x - radius, center.y - radius}, Vec2{center.x + radius, center.y + radius}, out);
}

void SpatialGrid::queryRect(const Rect& area, std::vector<Entity>& out) const {
    queryRect(Vec2{area.left(), area.top()}, Vec2{area.right(), area.bottom()}, out);
}

void SpatialGrid::queryRect(Vec2 min, Vec2 max, std::vector<Entity>& out) const {
    out.clear();
    if (!std::isfinite(min.x) || !std::isfinite(min.y) || !std::isfinite(max.x) || !std::isfinite(max.y)) {
        return;
    }
    if (min.x > max.x) std::swap(min.x, max.x);
    if (min.y > max.y) std::swap(min.y, max.y);

    if (++queryEpoch_ == 0) {
        std::fill(stamp_.begin(), stamp_.end(), 0);
        queryEpoch_ = 1;
    }

    const int x0 = cellX(min.x);
    const int x1 = cellX(max.x);
    const int y0 = cellY(min.y);
    const int y1 = cellY(max.y);
    for (int cy = y0; cy <= y1; ++cy) {
        for (int cx = x0; cx <= x1; ++cx) {
            const std::size_t b = bucketAt(cx, cy);
            if (bucketEpoch_[b] != epoch_) continue;   // last tick's contents
            for (const Entity e : buckets_[b]) {
                const std::uint32_t idx = entityIndex(e);
                if (idx < stamp_.size()) {
                    if (stamp_[idx] == queryEpoch_) continue;   // another of its cells
                    stamp_[idx] = queryEpoch_;
                }
                out.push_back(e);
            }
        }
    }
}

std::size_t SpatialGrid::reservedEntries() const {
    std::size_t total = 0;
    for (const std::vector<Entity>& bucket : buckets_) total += bucket.capacity();
    return total;
}

} // namespace flr
