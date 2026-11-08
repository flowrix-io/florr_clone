#pragma once
// What WorldRenderer's translation units share.
//
// WorldRenderer is one class across ten files, split by what each part draws
// (the list is at the top of world_renderer.cpp). A constant or helper that
// one file uses stays in that file's anonymous namespace; this header is only
// what more than one of them asks for. A helper that grows a second caller
// moves here then, and one that loses its last outside caller moves back.
//
// Nothing outside client/render/world_renderer*.cpp includes this.

#include "client/render/world_renderer.h"

#include <algorithm>
#include <cstdint>

#include "client/ui/draw.h"
#include "client/ui/item_tile.h"
#include "shared/game/config.h"

namespace flix::world_render {

/// A mob balloons to three times its size and fades out over this, which is
/// the only feedback there is that something died.
constexpr double kDeathAnimationSeconds = 0.2;

/// gardn's death animation, which every entity it deletes plays and which a
/// petal plays here: over 125 ms it fades out linearly while it grows to half
/// as big again, standing where it was last drawn (Client/Rendering.cc
/// _apply_damage_filter, deletion_animation += dt / 125).
constexpr double kPetalDeathSeconds = 0.125;

/// The window the TypeScript server averaged a dummy's DPS over. This client
/// works the figure out itself, from the viewer's own hits (dummyDamage_),
/// over the same window.
constexpr double kDpsWindowSeconds = 10.0;

constexpr std::uint32_t kExplosionOuter = 0xFF4500u;
constexpr std::uint32_t kExplosionInner = 0xFFD700u;

/// Lightning: white arms that flash and fade over half a second.
constexpr double kLightningLifeSeconds = 0.5;

/// The flower artwork is drawn in its own radius-25 space and scaled by the
/// player's size multiplier alone. `entity.radius` is the gameplay hitbox,
/// which grows with level -- the body never does.
constexpr double kFlowerArtRadius = 25.0;

/// A petal's artwork is 20 world units of diameter per size unit -- gardn's
/// petal radius, and the scale the item tile states its icons in
/// (ui::kPetalArtSize). Its hit radius is the same 10 per size unit -- a petal
/// hits what it looks like it hits -- and is only ever drawn as a debug
/// circle, which is now a ring around the artwork rather than well outside it.
using ui::kPetalArtSize;

/// A ground drop is the same item tile the menus draw, at its design size and
/// with the shadow behind it. Nothing about it is derived from the drop's
/// pickup radius: every drop reads the same size, whatever petal is on it.
constexpr double kDropBackdropSide = ui::kItemTileDesign;
/// Slides in from 30-50 units away, unwinding a spin of up to half a turn.
/// Shared with the oracle's slot, which lands an upgrade the same way.
constexpr double kDropSpawnSeconds = ui::kDropLandSeconds;

/// Flies to whoever took it, shrinking and fading; or spins out where it lay.
constexpr double kDropPickupSeconds = 0.15;
constexpr double kDropDespawnSeconds = 0.3;

/// A petal's `visual_scale`, as everything that paints one has to read it: art
/// only, and a zero (or an absent field) means "unscaled" rather than
/// "invisible", exactly as MobConfig::visualScale is treated.
inline double petalArtScale(const PetalConfig* config) {
    return (config && config->visualScale > 0) ? config->visualScale : 1.0;
}

/// A one-colour radial gradient, painted as nested discs because cpp_canvas
/// has no gradient: each disc's alpha is solved so that the coverage
/// accumulated over the discs still to come lands on `ramp(r)`. `ramp` takes
/// the distance from the centre in the units of `radius`, and should be zero
/// there.
template <typename Ramp>
void fillRadialRamp(Canvas& canvas, double radius, std::uint32_t rgb, int bands, Ramp ramp) {
    const int kBands = std::max(2, bands);
    double outerTarget = 0.0;
    for (int k = kBands; k >= 1; --k) {
        // Once the coverage is opaque, the discs inside it change nothing.
        if (outerTarget >= 1.0) break;
        const double outer = radius * k / kBands;
        const double target = ramp(radius * (k - 0.5) / kBands);
        const double alpha = 1.0 - (1.0 - target) / (1.0 - outerTarget);
        outerTarget = target;
        if (alpha <= 0.002) continue;
        ui::setFill(canvas, rgb, alpha);
        canvas.fillCircle(0, 0, static_cast<float>(outer));
    }
}

/// Same stable integer-hash shape used by the TypeScript glitch effect. The
/// C++ client has numeric network ids instead of socket-id strings, so the id
/// is the stable per-player seed.
inline double hash01(std::uint32_t a, std::uint32_t b) {
    std::uint32_t h = a * 374761393u + b * 668265263u;
    h = (h ^ (h >> 13)) * 1274126177u;
    return static_cast<double>(h ^ (h >> 16)) / 4294967296.0;
}

/// Paints with `tint` on for as long as it lives, then puts back whatever the
/// canvas had. A tint of alpha zero changes nothing.
class ScopedColorTint {
public:
    ScopedColorTint(Canvas& canvas, Color tint) : canvas_(canvas), saved_(canvas.colorTint()) {
        if (tint.a != 0) canvas.setColorTint(tint);
    }
    ~ScopedColorTint() { canvas_.setColorTint(saved_); }
    ScopedColorTint(const ScopedColorTint&) = delete;
    ScopedColorTint& operator=(const ScopedColorTint&) = delete;

private:
    Canvas& canvas_;
    Color saved_;
};

#ifdef __EMSCRIPTEN__
// The reference's MAX_BUFFER_SIDE (src/graphics/glitch-effect.ts): a body
// bigger than this is laid into the atlas smaller and stretched back on the
// way out, so the effect goes soft on exactly the biggest bodies rather than
// costing without limit.
constexpr int kGlitchMaxCell = 1024;
// The atlas is one of these two sizes: it starts small and grows once if a
// frame runs out of room. A frame that wants more than the larger holds draws
// the rest of its bursts without the effect -- a burst is on screen for a few
// frames at a time -- which is what a crowd of mythics at full zoom gets.
//
// No bigger than 1536, because the tint surface is twice as wide: Chrome
// rasters a canvas past about eight million pixels in pieces, and a 4096x2048
// one measured 8 GPU flushes a frame where 3072x1536 measured the expected 3.
constexpr int kGlitchMinAtlas = 1024;
constexpr int kGlitchMaxAtlas = 1536;
// Two seconds at 60 fps: an atlas nothing has wanted for that long is freed.
constexpr std::uint64_t kGlitchAtlasIdleFrames = 120;

inline int glitchAtlasSize(int atLeast) {
    return atLeast <= kGlitchMinAtlas ? kGlitchMinAtlas : kGlitchMaxAtlas;
}
#endif

} // namespace flix::world_render
