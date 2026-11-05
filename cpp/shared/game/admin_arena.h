#pragma once
#include <array>
#include <string>
#include <cstdint>
namespace flix {
struct AdminArenaTheme { const char* name; const char* floor; const char* wall; std::uint32_t color; };
inline constexpr std::array<AdminArenaTheme, 5> kAdminArenaThemes{{
    {"garden", "grass_c_0.svg", "castle_c_0.svg", 0x1EA761u},
    {"hel", "hel_c_0.svg", "hel_c_4.svg", 0x8F0606u},
    {"desert", "desert_c_0.svg", "dirt_c_0.svg", 0xD9CFA4u},
    {"computer", "computer_ground_black.svg", "computer_ground_green.svg", 0x0F3D2Au},
    {"jungle", "grass_c_1.svg", "dirt2_c_0.svg", 0x15A12Fu}
}};
inline int adminArenaTheme(const std::string& name) {
    for (std::size_t i = 0; i < kAdminArenaThemes.size(); ++i)
        if (name == kAdminArenaThemes[i].name) return static_cast<int>(i);
    return -1;
}
inline constexpr int kAdminArenaMaxSize = 128;
} // namespace flix
