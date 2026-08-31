#pragma once
// The game's visual language, in one place.
//
// The look is flat and high-contrast: saturated fills, thick dark outlines,
// generous corner radii, and text that is always stroked before it is filled
// so it stays readable over any background. Every panel and widget derives
// from these values rather than picking its own, which is what makes a screen
// assembled from separate pieces read as one design.

#include <cstdint>

namespace flr::ui {

// --- palette ----------------------------------------------------------------

inline constexpr std::uint32_t kInk        = 0x000000u;  ///< every outline
inline constexpr std::uint32_t kPaper      = 0xFFFFFFu;  ///< text and highlights
inline constexpr std::uint32_t kPanel      = 0x599FDCu;  ///< inventory-blue panel body
inline constexpr std::uint32_t kPanelDark  = 0x4A8BC2u;  ///< matching panel border
inline constexpr std::uint32_t kSlot       = 0xEEEEEEu;  ///< empty loadout slot
inline constexpr std::uint32_t kAccent     = 0x1DD129u;  ///< Ready / primary action
inline constexpr std::uint32_t kDanger     = 0xFF4444u;
inline constexpr std::uint32_t kWarning    = 0xFFE65Du;
inline constexpr std::uint32_t kHealth     = 0x73FF54u;
inline constexpr std::uint32_t kHealthBack = 0x000000u;
inline constexpr std::uint32_t kXpBar      = 0xFAFFC9u;
inline constexpr std::uint32_t kShade      = 0x000000u;  ///< modal scrim, at low alpha

/// Menus and the title screen sit on this; the world has its own biome ground.
inline constexpr std::uint32_t kBackdrop   = 0x00D885u;

// --- metrics ----------------------------------------------------------------

/// Outline width as a fraction of the element it surrounds. A constant ratio
/// rather than constant pixels, so a large panel and a small button read as
/// the same design.
inline constexpr double kOutlineRatio = 0.06;
inline constexpr double kMinOutline = 2.0;
inline constexpr double kMaxOutline = 6.0;

/// Text outline width per pixel of font size.
inline constexpr double kTextStrokeRatio = 0.12;

inline constexpr double kPanelRadius = 8.0;
inline constexpr double kSlotRadius = 6.0;
inline constexpr double kButtonRadius = 6.0;

inline constexpr double kPanelPadding = 14.0;
inline constexpr double kSlotSize = 56.0;
inline constexpr double kSlotGap = 8.0;

// --- type scale -------------------------------------------------------------

inline constexpr double kTitleSize = 42.0;
inline constexpr double kHeadingSize = 22.0;
inline constexpr double kBodySize = 15.0;
inline constexpr double kSmallSize = 12.0;
inline constexpr double kDamageSize = 18.0;

// --- helpers ----------------------------------------------------------------

/// Multiplies a colour's channels, for pressed and disabled states.
inline constexpr std::uint32_t shade(std::uint32_t rgb, double factor) {
    const auto channel = [factor](std::uint32_t c) -> std::uint32_t {
        const double v = static_cast<double>(c) * factor;
        return static_cast<std::uint32_t>(v < 0 ? 0 : (v > 255 ? 255 : v));
    };
    return (channel((rgb >> 16) & 0xFF) << 16) |
           (channel((rgb >> 8) & 0xFF) << 8) |
           channel(rgb & 0xFF);
}

inline constexpr std::uint32_t darken(std::uint32_t rgb, double amount = 0.25) {
    return shade(rgb, 1.0 - amount);
}

inline constexpr std::uint32_t lighten(std::uint32_t rgb, double amount = 0.25) {
    const auto channel = [amount](std::uint32_t c) -> std::uint32_t {
        const double v = c + (255.0 - c) * amount;
        return static_cast<std::uint32_t>(v > 255 ? 255 : v);
    };
    return (channel((rgb >> 16) & 0xFF) << 16) |
           (channel((rgb >> 8) & 0xFF) << 8) |
           channel(rgb & 0xFF);
}

/// Outline width for an element of the given size, kept within sane bounds so
/// a tiny icon is not swallowed by its own border.
inline double outlineFor(double size) {
    const double w = size * kOutlineRatio;
    return w < kMinOutline ? kMinOutline : (w > kMaxOutline ? kMaxOutline : w);
}

} // namespace flr::ui
