#pragma once
// Component type registration.
//
// A component is any movable C++ struct. It gets a dense integer id the first
// time it is mentioned, plus a vtable of the four operations the type-erased
// column storage needs. Ids are assigned lazily by a function-local static, so
// there is no static-initialisation-order hazard and no registration macro to
// forget.

#include <bitset>
#include <cstddef>
#include <cstdint>
#include <string>
#include <type_traits>
#include <vector>

namespace flix {

using ComponentId = std::uint16_t;

/// Upper bound on distinct component types. Raising it costs 8 bytes per
/// archetype mask; it is a compile-time constant so masks stay stack-sized.
inline constexpr std::size_t kMaxComponents = 128;

using ComponentMask = std::bitset<kMaxComponents>;

/// Type-erased operations a column needs to relocate and destroy its elements.
struct ComponentInfo {
    ComponentId id = 0;
    const char* name = "";
    std::size_t size = 0;
    std::size_t align = 0;
    /// True for types where a column can be relocated with memcpy and never
    /// destroyed. Nearly every hot component qualifies, and the fast paths in
    /// Archetype check this before falling back to per-element moves.
    bool trivial = false;

    void (*defaultConstruct)(void* dst) = nullptr;
    void (*destroy)(void* p) = nullptr;
    void (*moveConstruct)(void* dst, void* src) = nullptr;
    void (*moveAssign)(void* dst, void* src) = nullptr;
};

namespace detail {

/// Registers one component type and returns its id. Defined in world.cpp so
/// the registry is a single translation-unit-local vector.
ComponentId registerComponent(ComponentInfo info);

template <class T>
ComponentInfo makeComponentInfo(const char* name) {
    static_assert(std::is_move_constructible_v<T>, "components must be move-constructible");
    static_assert(std::is_default_constructible_v<T>, "components must be default-constructible");
    ComponentInfo info;
    info.name = name;
    info.size = sizeof(T);
    info.align = alignof(T);
    info.trivial = std::is_trivially_copyable_v<T> && std::is_trivially_destructible_v<T>;
    info.defaultConstruct = [](void* dst) { ::new (dst) T(); };
    info.destroy = [](void* p) { static_cast<T*>(p)->~T(); };
    info.moveConstruct = [](void* dst, void* src) { ::new (dst) T(std::move(*static_cast<T*>(src))); };
    info.moveAssign = [](void* dst, void* src) { *static_cast<T*>(dst) = std::move(*static_cast<T*>(src)); };
    return info;
}

} // namespace detail

/// Every component type must specialise this, which is also what gives the
/// type a stable human-readable name in diagnostics:
///     struct Position { Vec2 value; };
///     FLIX_COMPONENT(Position);
template <class T>
struct ComponentTraits;

#define FLIX_COMPONENT(Type)                                    \
    template <>                                                \
    struct ::flix::ComponentTraits<Type> {                      \
        static constexpr const char* name = #Type;             \
    }

/// The registry entry for `T`, assigned on first call.
template <class T>
const ComponentInfo& componentInfo() {
    static const ComponentInfo info = [] {
        ComponentInfo i = detail::makeComponentInfo<T>(ComponentTraits<T>::name);
        i.id = detail::registerComponent(i);
        return i;
    }();
    return info;
}

template <class T>
ComponentId componentId() { return componentInfo<T>().id; }

/// Number of component types registered so far. Diagnostics only.
std::size_t componentCount();

/// Registered info by id, or nullptr. Diagnostics only.
const ComponentInfo* componentById(ComponentId id);

/// Mask with a bit set for each of `Ts`.
template <class... Ts>
ComponentMask maskOf() {
    ComponentMask m;
    (m.set(componentId<Ts>()), ...);
    return m;
}

} // namespace flix
