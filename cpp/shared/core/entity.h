#pragma once
// Entity handles.
//
// A handle packs a slot INDEX with a GENERATION counter. The generation is
// bumped every time a slot is recycled, so a handle kept past its entity's
// destruction compares dead instead of silently addressing whatever moved in.
//
// Layout (64-bit):  [ 32 bits generation | 32 bits index ]
//
// Slot 0 is permanently reserved: index 0 with generation 0 packs to 0, which
// is NULL_ENTITY. Without the reservation the first entity ever created would
// be indistinguishable from "no entity", and every zero-initialised entity
// field would appear to point at it.

#include <cstdint>
#include <string>

namespace flr {

using Entity = std::uint64_t;

inline constexpr Entity NULL_ENTITY = 0;
inline constexpr std::uint32_t ENTITY_INDEX_MASK = 0xFFFFFFFFu;

inline constexpr std::uint32_t entityIndex(Entity e) {
    return static_cast<std::uint32_t>(e & ENTITY_INDEX_MASK);
}

inline constexpr std::uint32_t entityGeneration(Entity e) {
    return static_cast<std::uint32_t>(e >> 32);
}

inline constexpr Entity makeEntity(std::uint32_t index, std::uint32_t generation) {
    return (static_cast<Entity>(generation) << 32) | static_cast<Entity>(index);
}

std::string entityToString(Entity e);

} // namespace flr
