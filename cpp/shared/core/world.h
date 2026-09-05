#pragma once
// The ECS world: entity table, archetype graph, and queries.
//
//   Entity handle  ->  (archetype, row)
//   Archetype      ->  one contiguous column per component type
//
// Adding or removing a component MOVES the entity to a different archetype,
// which relocates every one of its components and swap-removes the old row.
// That is the expensive operation here, so state that toggles every few ticks
// belongs in a field on a component the entity always has, not in its own tag
// component. Tags are for what an entity fundamentally IS (a projectile, a
// petal, a centipede segment), which changes at most once in its lifetime.

#include "component.h"
#include "entity.h"
#include "types.h"

#include <cassert>
#include <cstring>
#include <functional>
#include <memory>
#include <unordered_map>
#include <vector>

namespace flix {

class World;

// ---------------------------------------------------------------------------
// Archetype
// ---------------------------------------------------------------------------

/// One column of type-erased, contiguous component storage.
struct Column {
    const ComponentInfo* info = nullptr;
    std::byte* data = nullptr;

    void* at(std::size_t row) { return data + row * info->size; }
    const void* at(std::size_t row) const { return data + row * info->size; }
};

/// All entities sharing exactly one component set.
class Archetype {
public:
    Archetype(ComponentMask mask, std::vector<ComponentId> ids);
    ~Archetype();
    Archetype(const Archetype&) = delete;
    Archetype& operator=(const Archetype&) = delete;

    const ComponentMask& mask() const { return mask_; }
    const std::vector<ComponentId>& componentIds() const { return ids_; }
    std::size_t count() const { return count_; }
    std::uint32_t index() const { return index_; }

    bool has(ComponentId id) const { return id < kMaxComponents && columnOf_[id] >= 0; }

    /// Raw column for `id`, or nullptr when this archetype lacks it.
    Column* column(ComponentId id) {
        if (id >= kMaxComponents) return nullptr;
        const int slot = columnOf_[id];
        return slot < 0 ? nullptr : &columns_[static_cast<std::size_t>(slot)];
    }

    template <class T>
    T* data() {
        Column* c = column(componentId<T>());
        return c ? reinterpret_cast<T*>(c->data) : nullptr;
    }

    const Entity* entities() const { return entities_.data(); }

private:
    friend class World;

    /// Appends a default-constructed row for `e` and returns its index.
    std::size_t addRow(Entity e);
    /// Swap-removes `row`. Returns the entity relocated into the hole, or
    /// NULL_ENTITY when `row` was last — the caller must repair its location.
    Entity removeRow(std::size_t row);
    void reserve(std::size_t capacity);

    ComponentMask mask_;
    std::vector<ComponentId> ids_;      // sorted ascending
    std::vector<Column> columns_;       // parallel to ids_
    std::int16_t columnOf_[kMaxComponents];
    std::vector<Entity> entities_;
    std::size_t count_ = 0;
    std::size_t capacity_ = 0;
    std::uint32_t index_ = 0;
};

// ---------------------------------------------------------------------------
// World
// ---------------------------------------------------------------------------

class World {
public:
    World();
    ~World();
    World(const World&) = delete;
    World& operator=(const World&) = delete;

    // -- entity lifecycle ---------------------------------------------------

    /// Creates an entity with no components.
    Entity create();

    /// Creates an entity carrying `Ts`, each default-constructed.
    template <class... Ts>
    Entity createWith() {
        Entity e = create();
        (add<Ts>(e), ...);
        return e;
    }

    /// True when the handle names a live entity. A handle whose slot has since
    /// been recycled reports false, which is the point of the generation field.
    bool isAlive(Entity e) const {
        if (e == NULL_ENTITY) return false;
        const std::uint32_t i = entityIndex(e);
        return i < slots_.size() && slots_[i].alive && slots_[i].generation == entityGeneration(e);
    }

    /// Destroys `e` and frees its slot. Safe on an already-dead handle.
    bool destroy(Entity e);

    /// Live entity count.
    std::size_t size() const { return liveCount_; }

    /// Bumped on every create and destroy, so a derived view can tell in O(1)
    /// whether it is stale. Deliberately NOT bumped by add/remove: those move
    /// an entity between archetypes but cannot change which entities exist.
    std::uint64_t version() const { return structuralVersion_; }

    // -- components ---------------------------------------------------------

    template <class T>
    bool has(Entity e) const {
        if (!isAlive(e)) return false;
        return archetypes_[slots_[entityIndex(e)].archetype]->has(componentId<T>());
    }

    /// Adds `T` (default-constructed) and returns a reference to it. Returns
    /// the existing component untouched when already present.
    template <class T>
    T& add(Entity e) {
        assertAlive(e, "add");
        const ComponentId id = componentId<T>();
        Slot& slot = slots_[entityIndex(e)];
        Archetype* from = archetypes_[slot.archetype].get();
        if (!from->has(id)) {
            auto ids = from->componentIds();
            ids.insert(std::lower_bound(ids.begin(), ids.end(), id), id);
            moveEntity(e, from, getOrCreateArchetype(std::move(ids)));
        }
        return *reinterpret_cast<T*>(
            archetypes_[slot.archetype]->column(id)->at(slot.row));
    }

    /// Adds `T` initialised to `value`, overwriting any existing component.
    template <class T>
    T& add(Entity e, T value) {
        T& ref = add<T>(e);
        ref = std::move(value);
        return ref;
    }

    /// Removes `T`. No-op when absent.
    template <class T>
    void remove(Entity e) {
        assertAlive(e, "remove");
        const ComponentId id = componentId<T>();
        Slot& slot = slots_[entityIndex(e)];
        Archetype* from = archetypes_[slot.archetype].get();
        if (!from->has(id)) return;
        auto ids = from->componentIds();
        ids.erase(std::remove(ids.begin(), ids.end(), id), ids.end());
        moveEntity(e, from, getOrCreateArchetype(std::move(ids)));
    }

    /// Pointer to `e`'s `T`, or nullptr when the entity is dead or lacks it.
    /// Prefer this to has()+get(): one lookup instead of two.
    template <class T>
    T* tryGet(Entity e) {
        if (!isAlive(e)) return nullptr;
        const Slot& slot = slots_[entityIndex(e)];
        Column* c = archetypes_[slot.archetype]->column(componentId<T>());
        return c ? reinterpret_cast<T*>(c->at(slot.row)) : nullptr;
    }

    template <class T>
    const T* tryGet(Entity e) const {
        return const_cast<World*>(this)->tryGet<T>(e);
    }

    /// Reference to `e`'s `T`. Undefined behaviour if absent — use only where
    /// the query or prefab guarantees presence.
    template <class T>
    T& get(Entity e) {
        T* p = tryGet<T>(e);
        assert(p && "World::get on an entity without that component");
        return *p;
    }

    /// Adds `T` when missing and returns it either way.
    template <class T>
    T& ensure(Entity e) {
        if (T* p = tryGet<T>(e)) return *p;
        return add<T>(e);
    }

    // -- archetype access for queries ---------------------------------------

    const std::vector<std::unique_ptr<Archetype>>& archetypes() const { return archetypes_; }
    std::size_t archetypeCount() const { return archetypes_.size(); }

    // -- named entities -----------------------------------------------------
    //
    // The parts of the game that address an entity by an outside name (a
    // connection id, a persisted mob id) go through here rather than keeping
    // their own map, so destroy() can drop the binding in one place and never
    // leak a dangling name.

    void bindName(Entity e, std::string name);
    Entity lookup(const std::string& name) const;
    const std::string* nameOf(Entity e) const;

    /// Destroys every entity. Keeps archetypes so the storage is reused.
    void clear();

private:
    struct Slot {
        std::uint32_t generation = 0;
        std::uint32_t archetype = 0;
        std::uint32_t row = 0;
        bool alive = false;
    };

    void assertAlive(Entity e, const char* op) const;
    Archetype* getOrCreateArchetype(std::vector<ComponentId> ids);
    void moveEntity(Entity e, Archetype* from, Archetype* to);
    void releaseRow(Archetype* archetype, std::size_t row);

    std::vector<Slot> slots_;
    std::vector<std::uint32_t> freeSlots_;
    std::size_t liveCount_ = 0;
    std::uint64_t structuralVersion_ = 0;

    std::vector<std::unique_ptr<Archetype>> archetypes_;
    std::unordered_map<std::string, std::uint32_t> archetypeByKey_;

    std::unordered_map<std::string, Entity> byName_;
    std::vector<std::string> names_;
};

// ---------------------------------------------------------------------------
// Query
// ---------------------------------------------------------------------------

/// A cached set of archetypes matching a component filter.
///
/// Build one per system and reuse it every tick: the matched-archetype list is
/// rebuilt only when the world grows a new archetype, so steady-state iteration
/// costs nothing beyond the loop. Constructing a Query per tick throws that
/// away, and is the one way to make this slow.
template <class... Ts>
class Query {
public:
    explicit Query(World& world) : world_(&world), all_(maskOf<Ts...>()) {}

    /// Excludes entities carrying any of `Es`. Chainable at construction:
    ///     Query<Position, Velocity> movers{world}; movers.without<Frozen>();
    template <class... Es>
    Query& without() {
        none_ |= maskOf<Es...>();
        seenArchetypes_ = static_cast<std::size_t>(-1);
        return *this;
    }

    /// Calls `fn(Entity, Ts&...)` for every matching entity.
    ///
    /// Structural changes (create/destroy/add/remove) during iteration
    /// invalidate the column pointers. Queue them and apply after the loop —
    /// CommandBuffer exists for exactly this.
    template <class F>
    void each(F&& fn) {
        refresh();
        for (const std::uint32_t ai : matched_) {
            Archetype& a = *world_->archetypes()[ai];
            const std::size_t n = a.count();
            if (n == 0) continue;
            std::tuple<Ts*...> cols{a.template data<Ts>()...};
            const Entity* ents = a.entities();
            for (std::size_t i = 0; i < n; ++i) {
                fn(ents[i], std::get<Ts*>(cols)[i]...);
            }
        }
    }

    /// Calls `fn(count, const Entity*, Ts*...)` once per matching archetype,
    /// handing over raw column pointers. For hot loops that want to hoist
    /// everything above the row loop, or to SIMD over a column.
    template <class F>
    void chunks(F&& fn) {
        refresh();
        for (const std::uint32_t ai : matched_) {
            Archetype& a = *world_->archetypes()[ai];
            if (a.count() == 0) continue;
            fn(a.count(), a.entities(), a.template data<Ts>()...);
        }
    }

    /// Snapshots matching entities into `out`.
    ///
    /// Allocates, so this is for setup, teardown and the "act on everything
    /// matching, possibly destroying it" case — taking the snapshot first is
    /// what makes structural mutation safe there.
    std::vector<Entity>& collect(std::vector<Entity>& out) {
        out.clear();
        refresh();
        for (const std::uint32_t ai : matched_) {
            Archetype& a = *world_->archetypes()[ai];
            out.insert(out.end(), a.entities(), a.entities() + a.count());
        }
        return out;
    }

    std::vector<Entity> collect() {
        std::vector<Entity> out;
        collect(out);
        return out;
    }

    std::size_t count() {
        refresh();
        std::size_t n = 0;
        for (const std::uint32_t ai : matched_) n += world_->archetypes()[ai]->count();
        return n;
    }

    /// The first matching entity, or NULL_ENTITY. For singletons.
    Entity first() {
        refresh();
        for (const std::uint32_t ai : matched_) {
            Archetype& a = *world_->archetypes()[ai];
            if (a.count() > 0) return a.entities()[0];
        }
        return NULL_ENTITY;
    }

private:
    void refresh() {
        const std::size_t total = world_->archetypeCount();
        if (seenArchetypes_ == total) return;
        matched_.clear();
        for (std::size_t i = 0; i < total; ++i) {
            const ComponentMask& m = world_->archetypes()[i]->mask();
            if ((m & all_) == all_ && (m & none_).none()) {
                matched_.push_back(static_cast<std::uint32_t>(i));
            }
        }
        seenArchetypes_ = total;
    }

    World* world_;
    ComponentMask all_;
    ComponentMask none_;
    std::vector<std::uint32_t> matched_;
    std::size_t seenArchetypes_ = static_cast<std::size_t>(-1);
};

// ---------------------------------------------------------------------------
// CommandBuffer
// ---------------------------------------------------------------------------

/// Structural changes deferred until a safe point.
///
/// Systems iterate columns by pointer, so creating or destroying an entity
/// mid-iteration can reallocate the very array being walked. Every system
/// therefore records its structural intent here and the runtime flushes once
/// per phase, at a point where nothing holds a column pointer.
class CommandBuffer {
public:
    explicit CommandBuffer(World& world) : world_(&world) {}

    void destroy(Entity e) { destroys_.push_back(e); }

    /// Runs `fn(World&)` at flush time. The general escape hatch for "spawn
    /// this thing, but not from inside the loop that decided to".
    void defer(std::function<void(World&)> fn) { deferred_.push_back(std::move(fn)); }

    template <class T>
    void addComponent(Entity e, T value) {
        deferred_.push_back([e, v = std::move(value)](World& w) mutable {
            if (w.isAlive(e)) w.add<T>(e, std::move(v));
        });
    }

    template <class T>
    void removeComponent(Entity e) {
        deferred_.push_back([e](World& w) {
            if (w.isAlive(e)) w.remove<T>(e);
        });
    }

    bool empty() const { return destroys_.empty() && deferred_.empty(); }

    /// Applies deferred work, then destroys. Destroys run last so a command
    /// that spawns a replacement for a dying entity is not itself undone.
    void flush() {
        // Swap the queues out first: a deferred command may enqueue more work,
        // and appending to a vector being iterated would invalidate it.
        auto deferred = std::move(deferred_);
        deferred_.clear();
        for (auto& fn : deferred) fn(*world_);

        auto destroys = std::move(destroys_);
        destroys_.clear();
        for (const Entity e : destroys) world_->destroy(e);

        // A destroy handler may have queued more; drain to a fixed point so a
        // chain (mob dies -> drops loot -> loot expires) never straddles ticks.
        if (!empty()) flush();
    }

private:
    World* world_;
    std::vector<Entity> destroys_;
    std::vector<std::function<void(World&)>> deferred_;
};

} // namespace flix
