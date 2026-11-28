#include "shared/game/spatial.h"

#include <algorithm>
#include <cmath>
#include <limits>

#include "shared/game/realm.h"
#include "shared/game/terrain.h"

namespace flix {

namespace {

/// Sizes one layer to a span, keeping its buckets when the count is unchanged.
void fitLayer(int& cols, int& rows, std::vector<std::vector<Entity>>& buckets,
              std::vector<std::uint32_t>& bucketEpoch, double span, double invCellSize,
              int maxAxisCells) {
    const double side = std::isfinite(span) && span > 0 ? span : kWorldSize;
    const int axis = clamp(static_cast<int>(std::ceil(std::min(side, 1e9) * invCellSize)), 1,
                           maxAxisCells);
    if (axis == cols && axis == rows && !buckets.empty()) return;
    cols = axis;
    rows = axis;
    const std::size_t cells = static_cast<std::size_t>(cols) * static_cast<std::size_t>(rows);
    buckets.assign(cells, {});
    bucketEpoch.assign(cells, 0);
}

} // namespace

SpatialGrid::SpatialGrid(double cellSize) {
    cellSize_ = (std::isfinite(cellSize) && cellSize > 1.0) ? cellSize : kDefaultCellSize;
    invCellSize_ = 1.0 / cellSize_;

    // No Terrain yet. The two generated realms are fixed shapes the class can
    // size on its own; the overworld gets the default world; every other map
    // realm gets ONE cell until sizeToRealms() says what shape it really is,
    // because sizing sixty layers nobody staged a map for to the full world
    // would be a few hundred thousand empty buckets.
    for (int i = 0; i < kMaxRealms; ++i) {
        const Realm realm = static_cast<Realm>(i);
        double span = 0.0;
        if (realm == Realm::Overworld) span = kWorldSize;
        else if (realm == Realm::Arena) span = kArenaWorldSize;
        else if (realm == kWavesRealm) span = kWavesWorldSize;
        else if (realm == Realm::Maze) span = activeMaze().worldSize();
        Layer& layer = layers_[static_cast<std::size_t>(i)];
        fitLayer(layer.cols, layer.rows, layer.buckets, layer.bucketEpoch, span, invCellSize_,
                 span > 0.0 ? kMaxAxisCells : 1);
        fitFine(layer);
    }
}

void SpatialGrid::sizeToRealms(const Terrain& terrain) {
    for (int i = 0; i < kMaxRealms; ++i) {
        const Realm realm = static_cast<Realm>(i);
        Layer& layer = layers_[static_cast<std::size_t>(i)];
        // A map realm nothing was staged for stays one cell: nothing can be
        // in it, and a layer the size of the world for it is pure waste.
        const bool live = !isWorldRealm(realm) || terrain.hasMap(realm);
        fitLayer(layer.cols, layer.rows, layer.buckets, layer.bucketEpoch,
                 terrain.realmSize(realm), invCellSize_, live ? kMaxAxisCells : 1);
        fitFine(layer);
    }
    // Every bucket is new or reused, and any that was reused may still hold
    // last tick's entities under a live epoch. Retire the lot.
    epoch_ = 1;
    for (Layer& layer : layers_) {
        std::fill(layer.bucketEpoch.begin(), layer.bucketEpoch.end(), 0);
        std::fill(layer.fineEpoch.begin(), layer.fineEpoch.end(), 0);
    }
    std::fill(filed_.begin(), filed_.end(), 0);
    refiled_ = false;
    inserted_ = 0;
    fineEpoch_ = 0;
    fineUsed_ = 0;
}

void SpatialGrid::fitFine(Layer& layer) {
    if (layer.fineEpoch.size() == layer.buckets.size()) return;
    layer.fineEpoch.assign(layer.buckets.size(), 0);
    layer.fineSlot.assign(layer.buckets.size(), 0);
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
    refiled_ = false;
    if (++epoch_ == 0) {
        // Once every four billion ticks the epoch wraps onto the value stale
        // buckets already carry, so retire them all for real. Never hit in a
        // session; cheap enough that it does not need to be.
        for (Layer& layer : layers_) {
            std::fill(layer.bucketEpoch.begin(), layer.bucketEpoch.end(), 0);
            std::fill(layer.fineEpoch.begin(), layer.fineEpoch.end(), 0);
        }
        std::fill(filed_.begin(), filed_.end(), 0);
        epoch_ = 1;
        fineEpoch_ = 0;
    }
}

void SpatialGrid::insert(Entity e, Realm realm, Vec2 position, double radius) {
    if (e == NULL_ENTITY) return;
    // A NaN position cannot be found by any query, so filing it would only
    // give a later reader a corrupt candidate to trip over.
    if (!std::isfinite(position.x) || !std::isfinite(position.y)) return;
    const double filedRadius = radius;
    if (!std::isfinite(radius) || radius < 0.0) radius = 0.0;

    const std::uint32_t idx = entityIndex(e);
    if (idx >= stamp_.size()) {
        // Grown here rather than in query(), so the read path never allocates.
        stamp_.resize(std::max<std::size_t>(static_cast<std::size_t>(idx) + 1, stamp_.size() * 2), 0);
        filed_.resize(stamp_.size(), 0);
        filedCircles_.resize(stamp_.size());
    }
    if (filed_[idx] == epoch_) refiled_ = true;
    filed_[idx] = epoch_;
    filedCircles_[idx] = FiledCircle{position, filedRadius};

    Layer& target = layer(realm);
    const int x0 = cellX(realm, position.x - radius);
    const int x1 = cellX(realm, position.x + radius);
    const int y0 = cellY(realm, position.y - radius);
    const int y1 = cellY(realm, position.y + radius);
    for (int cy = y0; cy <= y1; ++cy) {
        for (int cx = x0; cx <= x1; ++cx) {
            const std::size_t b = target.bucketAt(cx, cy);
            if (target.bucketEpoch[b] != epoch_) {
                target.buckets[b].clear();
                target.bucketEpoch[b] = epoch_;
            }
            target.buckets[b].push_back(e);
            // A split made before this insert no longer holds the bucket.
            target.fineEpoch[b] = 0;
        }
    }
    ++inserted_;
}

void SpatialGrid::query(Realm realm, Vec2 center, double radius, std::vector<Entity>& out) const {
    if (!std::isfinite(radius) || radius < 0.0) radius = 0.0;
    queryRect(realm, Vec2{center.x - radius, center.y - radius},
              Vec2{center.x + radius, center.y + radius}, out);
}

void SpatialGrid::queryRect(Realm realm, const Rect& area, std::vector<Entity>& out) const {
    queryRect(realm, Vec2{area.left(), area.top()}, Vec2{area.right(), area.bottom()}, out);
}

void SpatialGrid::queryRect(Realm realm, Vec2 min, Vec2 max, std::vector<Entity>& out) const {
    out.clear();
    if (!std::isfinite(min.x) || !std::isfinite(min.y) || !std::isfinite(max.x) || !std::isfinite(max.y)) {
        return;
    }
    if (min.x > max.x) std::swap(min.x, max.x);
    if (min.y > max.y) std::swap(min.y, max.y);

    const Layer& source = layer(realm);
    const int x0 = cellX(realm, min.x);
    const int x1 = cellX(realm, max.x);
    const int y0 = cellY(realm, min.y);
    const int y1 = cellY(realm, max.y);

    // One cell and nothing filed twice: the bucket IS the answer, in the order
    // the walk below would give it and with nothing in it to strip.
    if (x0 == x1 && y0 == y1 && !refiled_) {
        const std::size_t b = source.bucketAt(x0, y0);
        if (source.bucketEpoch[b] == epoch_) {
            out.assign(source.buckets[b].begin(), source.buckets[b].end());
        }
        return;
    }

    if (++queryEpoch_ == 0) {
        std::fill(stamp_.begin(), stamp_.end(), 0);
        queryEpoch_ = 1;
    }
    for (int cy = y0; cy <= y1; ++cy) {
        for (int cx = x0; cx <= x1; ++cx) {
            const std::size_t b = source.bucketAt(cx, cy);
            if (source.bucketEpoch[b] != epoch_) continue;   // last tick's contents
            const std::vector<Entity>& bucket = source.buckets[b];
            // Room for the whole bucket, then written through a pointer and
            // trimmed to what was kept: a push_back per candidate was half of
            // what a query cost.
            const std::size_t base = out.size();
            out.resize(base + bucket.size());
            Entity* write = out.data() + base;
            for (const Entity e : bucket) {
                const std::uint32_t idx = entityIndex(e);
                if (idx < stamp_.size()) {
                    if (stamp_[idx] == queryEpoch_) continue;   // another of its cells
                    stamp_[idx] = queryEpoch_;
                }
                *write++ = e;
            }
            out.resize(static_cast<std::size_t>(write - out.data()));
        }
    }
}

int SpatialGrid::fineIndex(double offset) const {
    return cellIndex(offset, invCellSize_ * kFineSplit, kFineSplit);
}

const SpatialGrid::FineBucket& SpatialGrid::fineBucket(const Layer& source, std::size_t bucket,
                                                       int cx, int cy) const {
    if (fineEpoch_ != epoch_) {
        fineEpoch_ = epoch_;
        fineUsed_ = 0;
    }
    if (source.fineEpoch[bucket] == epoch_) return fine_[source.fineSlot[bucket]];

    if (fineUsed_ == fine_.size()) fine_.emplace_back();
    const std::size_t slot = fineUsed_++;
    source.fineEpoch[bucket] = epoch_;
    source.fineSlot[bucket] = static_cast<std::uint32_t>(slot);
    FineBucket& split = fine_[slot];

    // Sub-cells are counted from the bucket's own corner and clamped into it,
    // as the bucket's are clamped into the layer: whatever sits past an edge
    // shares the edge's sub-cells, and the part of a circle in the bucket next
    // door is that bucket's to file.
    const Vec2 corner{cx * cellSize_, cy * cellSize_};
    const std::vector<Entity>& members = source.buckets[bucket];
    const auto span = [&](const FiledCircle& circle, int& x0, int& x1, int& y0, int& y1) {
        // insert()'s own clamp, so a sub-cell covers what its bucket does.
        const double r = std::isfinite(circle.radius) && circle.radius > 0.0 ? circle.radius : 0.0;
        x0 = fineIndex(circle.position.x - r - corner.x);
        x1 = fineIndex(circle.position.x + r - corner.x);
        y0 = fineIndex(circle.position.y - r - corner.y);
        y1 = fineIndex(circle.position.y + r - corner.y);
    };

    // A counting sort: counted one sub-cell along, so that once summed each
    // entry is where its own sub-cell starts.
    split.start.fill(0);
    for (const Entity e : members) {
        int x0, x1, y0, y1;
        span(filedCircles_[entityIndex(e)], x0, x1, y0, y1);
        for (int sy = y0; sy <= y1; ++sy) {
            for (int sx = x0; sx <= x1; ++sx) ++split.start[sy * kFineSplit + sx + 1];
        }
    }
    for (int c = 1; c <= kFineCells; ++c) split.start[c] += split.start[c - 1];
    split.entries.resize(split.start[kFineCells]);
    std::array<std::uint32_t, kFineCells> cursor;
    std::copy(split.start.begin(), split.start.begin() + kFineCells, cursor.begin());
    for (const Entity e : members) {
        const FiledCircle& circle = filedCircles_[entityIndex(e)];
        int x0, x1, y0, y1;
        span(circle, x0, x1, y0, y1);
        const double reach = std::isnan(circle.radius)
                                 ? std::numeric_limits<double>::infinity()
                                 : std::max(0.0, circle.radius);
        for (int sy = y0; sy <= y1; ++sy) {
            for (int sx = x0; sx <= x1; ++sx) {
                split.entries[cursor[sy * kFineSplit + sx]++] = FineEntry{e, circle.position, reach};
            }
        }
    }
    return split;
}

void SpatialGrid::queryOverlapping(Realm realm, Vec2 center, double radius,
                                   std::vector<Entity>& out) const {
    // Filed twice, no one circle is an entity's: query()'s superset is what
    // is left to give.
    if (refiled_) {
        query(realm, center, radius, out);
        return;
    }
    out.clear();
    if (!std::isfinite(center.x) || !std::isfinite(center.y)) return;
    if (!std::isfinite(radius) || radius < 0.0) radius = 0.0;

    const Layer& source = layer(realm);
    const Vec2 min{center.x - radius, center.y - radius};
    const Vec2 max{center.x + radius, center.y + radius};
    const int x0 = cellX(realm, min.x);
    const int x1 = cellX(realm, max.x);
    const int y0 = cellY(realm, min.y);
    const int y1 = cellY(realm, max.y);

    // Every answer is stamped, because a body touching two sub-cells or two
    // buckets is under both -- but only once it has passed the overlap test,
    // which is what turns most entries away.
    if (++queryEpoch_ == 0) {
        std::fill(stamp_.begin(), stamp_.end(), 0);
        queryEpoch_ = 1;
    }
    for (int cy = y0; cy <= y1; ++cy) {
        for (int cx = x0; cx <= x1; ++cx) {
            const std::size_t b = source.bucketAt(cx, cy);
            if (source.bucketEpoch[b] != epoch_) continue;   // last tick's contents
            const FineBucket& split = fineBucket(source, b, cx, cy);
            const Vec2 corner{cx * cellSize_, cy * cellSize_};
            const int sx0 = fineIndex(min.x - corner.x);
            const int sx1 = fineIndex(max.x - corner.x);
            const int sy0 = fineIndex(min.y - corner.y);
            const int sy1 = fineIndex(max.y - corner.y);
            for (int sy = sy0; sy <= sy1; ++sy) {
                const std::uint32_t begin = split.start[sy * kFineSplit + sx0];
                const std::uint32_t end = split.start[sy * kFineSplit + sx1 + 1];
                for (std::uint32_t i = begin; i < end; ++i) {
                    const FineEntry& entry = split.entries[i];
                    const double reach = radius + entry.reach;
                    if (distanceSq(entry.position, center) > reach * reach) continue;
                    const std::uint32_t idx = entityIndex(entry.entity);
                    if (stamp_[idx] == queryEpoch_) continue;   // another of its cells
                    stamp_[idx] = queryEpoch_;
                    out.push_back(entry.entity);
                }
            }
        }
    }
}

std::size_t SpatialGrid::reservedEntries() const {
    std::size_t total = 0;
    for (const Layer& layer : layers_) {
        for (const std::vector<Entity>& bucket : layer.buckets) total += bucket.capacity();
    }
    return total;
}

} // namespace flix
