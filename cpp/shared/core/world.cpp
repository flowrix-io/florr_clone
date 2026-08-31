#include "world.h"

#include <algorithm>
#include <cstdlib>
#include <stdexcept>
#include <string>

namespace flr {

// ---------------------------------------------------------------------------
// entity.h
// ---------------------------------------------------------------------------

std::string entityToString(Entity e) {
    if (e == NULL_ENTITY) return "Entity(null)";
    return "Entity(" + std::to_string(entityIndex(e)) + "v" +
           std::to_string(entityGeneration(e)) + ")";
}

// ---------------------------------------------------------------------------
// Component registry
// ---------------------------------------------------------------------------

namespace {

// Archetype columns hold a `const ComponentInfo*` for the lifetime of the
// world, so entries must never move. A fixed array (rather than a vector that
// reallocates as later component types register themselves) is what makes
// those pointers stable.
struct Registry {
    ComponentInfo entries[kMaxComponents];
    std::size_t count = 0;
};

Registry& registry() {
    static Registry r;
    return r;
}

} // namespace

namespace detail {
ComponentId registerComponent(ComponentInfo info) {
    Registry& r = registry();
    if (r.count >= kMaxComponents) {
        throw std::runtime_error("component registry full; raise flr::kMaxComponents");
    }
    info.id = static_cast<ComponentId>(r.count);
    r.entries[r.count++] = info;
    return info.id;
}
} // namespace detail

std::size_t componentCount() { return registry().count; }

const ComponentInfo* componentById(ComponentId id) {
    Registry& r = registry();
    return id < r.count ? &r.entries[id] : nullptr;
}

// ---------------------------------------------------------------------------
// Archetype
// ---------------------------------------------------------------------------

namespace {

void* alignedAllocate(std::size_t bytes, std::size_t align) {
    if (bytes == 0) return nullptr;
    // aligned_alloc requires a size that is a multiple of the alignment.
    const std::size_t alignment = std::max<std::size_t>(align, alignof(std::max_align_t));
    const std::size_t rounded = ((bytes + alignment - 1) / alignment) * alignment;
    void* p = std::aligned_alloc(alignment, rounded);
    if (!p) throw std::bad_alloc();
    return p;
}

} // namespace

Archetype::Archetype(ComponentMask mask, std::vector<ComponentId> ids)
    : mask_(mask), ids_(std::move(ids)) {
    std::fill(std::begin(columnOf_), std::end(columnOf_), static_cast<std::int16_t>(-1));
    columns_.reserve(ids_.size());
    for (std::size_t i = 0; i < ids_.size(); ++i) {
        Column c;
        c.info = componentById(ids_[i]);
        columns_.push_back(c);
        columnOf_[ids_[i]] = static_cast<std::int16_t>(i);
    }
}

Archetype::~Archetype() {
    for (Column& c : columns_) {
        if (!c.data) continue;
        if (!c.info->trivial) {
            for (std::size_t row = 0; row < count_; ++row) c.info->destroy(c.at(row));
        }
        std::free(c.data);
    }
}

void Archetype::reserve(std::size_t capacity) {
    if (capacity <= capacity_) return;
    // Geometric growth from a small floor. Most archetypes hold a handful of
    // entities (one per player, one per boss), so starting at 8 keeps the long
    // tail cheap while the crowded ones still double.
    std::size_t next = capacity_ == 0 ? 8 : capacity_;
    while (next < capacity) next *= 2;

    for (Column& c : columns_) {
        auto* fresh = static_cast<std::byte*>(alignedAllocate(next * c.info->size, c.info->align));
        if (c.data) {
            if (c.info->trivial) {
                std::memcpy(fresh, c.data, count_ * c.info->size);
            } else {
                for (std::size_t row = 0; row < count_; ++row) {
                    c.info->moveConstruct(fresh + row * c.info->size, c.at(row));
                    c.info->destroy(c.at(row));
                }
            }
            std::free(c.data);
        }
        c.data = fresh;
    }
    entities_.resize(next);
    capacity_ = next;
}

std::size_t Archetype::addRow(Entity e) {
    if (count_ == capacity_) reserve(count_ + 1);
    const std::size_t row = count_++;
    entities_[row] = e;
    // Always default-CONSTRUCT, never memset.
    //
    // Zeroing looks like a harmless fast path for a trivially copyable type,
    // and it silently throws away every in-class initialiser: a component
    // declaring `double speedScale = 1.0` would arrive as 0.0, and a system
    // multiplying by it would quietly do nothing at all. The compiler emits a
    // trivial constructor for these types anyway, so the "fast path" bought
    // nothing to begin with.
    for (Column& c : columns_) c.info->defaultConstruct(c.at(row));
    return row;
}

Entity Archetype::removeRow(std::size_t row) {
    const std::size_t last = count_ - 1;
    Entity moved = NULL_ENTITY;

    if (row != last) {
        for (Column& c : columns_) {
            if (c.info->trivial) {
                std::memcpy(c.at(row), c.at(last), c.info->size);
            } else {
                c.info->moveAssign(c.at(row), c.at(last));
            }
        }
        entities_[row] = entities_[last];
        moved = entities_[row];
    }

    if (!columns_.empty()) {
        for (Column& c : columns_) {
            if (!c.info->trivial) c.info->destroy(c.at(last));
        }
    }
    count_ = last;
    return moved;
}

// ---------------------------------------------------------------------------
// World
// ---------------------------------------------------------------------------

namespace {

std::string archetypeKey(const std::vector<ComponentId>& ids) {
    std::string key;
    key.reserve(ids.size() * 4);
    for (const ComponentId id : ids) {
        key += std::to_string(id);
        key += ',';
    }
    return key;
}

} // namespace

World::World() {
    // Slot 0 is reserved so that no live handle can equal NULL_ENTITY.
    slots_.push_back(Slot{});
    names_.emplace_back();
    // The empty archetype holds freshly created, component-less entities.
    getOrCreateArchetype({});
}

World::~World() = default;

Entity World::create() {
    std::uint32_t index;
    if (!freeSlots_.empty()) {
        index = freeSlots_.back();
        freeSlots_.pop_back();
    } else {
        index = static_cast<std::uint32_t>(slots_.size());
        slots_.push_back(Slot{});
        names_.emplace_back();
    }

    Slot& slot = slots_[index];
    const Entity e = makeEntity(index, slot.generation);
    slot.alive = true;
    slot.archetype = 0;
    slot.row = static_cast<std::uint32_t>(archetypes_[0]->addRow(e));

    ++liveCount_;
    ++structuralVersion_;
    return e;
}

bool World::destroy(Entity e) {
    if (!isAlive(e)) return false;
    const std::uint32_t index = entityIndex(e);
    Slot& slot = slots_[index];

    releaseRow(archetypes_[slot.archetype].get(), slot.row);

    if (!names_[index].empty()) {
        byName_.erase(names_[index]);
        names_[index].clear();
    }

    slot.alive = false;
    // Wrapping the generation is fine: a handle only aliases after 2^32
    // recycles of the same slot, which no session reaches.
    ++slot.generation;

    freeSlots_.push_back(index);
    --liveCount_;
    ++structuralVersion_;
    return true;
}

void World::clear() {
    for (std::uint32_t i = 1; i < slots_.size(); ++i) {
        if (slots_[i].alive) destroy(makeEntity(i, slots_[i].generation));
    }
    byName_.clear();
}

void World::assertAlive(Entity e, const char* op) const {
    if (!isAlive(e)) {
        throw std::runtime_error(std::string(op) + "() on dead or invalid " + entityToString(e));
    }
}

Archetype* World::getOrCreateArchetype(std::vector<ComponentId> ids) {
    std::sort(ids.begin(), ids.end());
    const std::string key = archetypeKey(ids);
    if (auto it = archetypeByKey_.find(key); it != archetypeByKey_.end()) {
        return archetypes_[it->second].get();
    }

    ComponentMask mask;
    for (const ComponentId id : ids) mask.set(id);

    auto archetype = std::make_unique<Archetype>(mask, std::move(ids));
    archetype->index_ = static_cast<std::uint32_t>(archetypes_.size());
    Archetype* raw = archetype.get();
    archetypeByKey_.emplace(key, archetype->index_);
    archetypes_.push_back(std::move(archetype));
    return raw;
}

void World::moveEntity(Entity e, Archetype* from, Archetype* to) {
    Slot& slot = slots_[entityIndex(e)];
    const std::size_t fromRow = slot.row;
    const std::size_t toRow = to->addRow(e);

    // Carry over every component the two archetypes share. Components only in
    // `from` are dropped; components only in `to` keep their fresh default.
    for (const ComponentId id : to->componentIds()) {
        Column* src = from->column(id);
        if (!src) continue;
        Column* dst = to->column(id);
        if (src->info->trivial) {
            std::memcpy(dst->at(toRow), src->at(fromRow), src->info->size);
        } else {
            src->info->moveAssign(dst->at(toRow), src->at(fromRow));
        }
    }

    slot.archetype = to->index();
    slot.row = static_cast<std::uint32_t>(toRow);
    releaseRow(from, fromRow);
}

void World::releaseRow(Archetype* archetype, std::size_t row) {
    const Entity moved = archetype->removeRow(row);
    if (moved != NULL_ENTITY) {
        slots_[entityIndex(moved)].row = static_cast<std::uint32_t>(row);
    }
}

// -- names ------------------------------------------------------------------

void World::bindName(Entity e, std::string name) {
    assertAlive(e, "bindName");
    const std::uint32_t index = entityIndex(e);
    if (!names_[index].empty()) byName_.erase(names_[index]);

    // Rebinding a name that another entity still holds must clear it there
    // too. Otherwise both entities believe they own it, and destroying the
    // stale one erases the binding out from under the live one.
    if (auto it = byName_.find(name); it != byName_.end()) {
        const std::uint32_t previous = entityIndex(it->second);
        if (previous < names_.size()) names_[previous].clear();
    }

    byName_[name] = e;
    names_[index] = std::move(name);
}

Entity World::lookup(const std::string& name) const {
    auto it = byName_.find(name);
    if (it == byName_.end()) return NULL_ENTITY;
    // A stale binding can only happen if destroy() was bypassed; treat the
    // handle as authoritative rather than trusting the map.
    return isAlive(it->second) ? it->second : NULL_ENTITY;
}

const std::string* World::nameOf(Entity e) const {
    if (!isAlive(e)) return nullptr;
    const std::string& name = names_[entityIndex(e)];
    return name.empty() ? nullptr : &name;
}

} // namespace flr
