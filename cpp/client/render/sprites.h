#pragma once
// Compiled artwork for mobs and petals.
//
// Every sprite in the game is an inline SVG document inside mobs.json /
// petals.json. Those are parsed ONCE at startup into retained SvgDocuments and
// drawn straight to the canvas thereafter -- there is no bitmap bake. Baking
// mobs to bitmaps was tried in the original and cost more than it saved: a
// rarity-scaled mob needs a bitmap per size, the cache thrashes as soon as a
// crowd is on screen, and the vector path is fast enough.

#include <cstdint>
#include <memory>
#include <string>
#include <vector>

#include "canvas.h"
#include "svg.h"

#include "shared/game/rarity.h"

namespace flr {

class ContentRegistry;

class SpriteCache {
public:
    /// Compiles every mob and petal image in `content`. Returns false only if
    /// content itself is unusable; an individual sprite that fails to parse is
    /// recorded as a warning and drawn as a coloured disc instead, so one bad
    /// document never takes the game down.
    bool build(const ContentRegistry& content);

    /// Draws mob `index` centred at (x, y), fitted to `diameter` pixels, with
    /// `rotation` radians applied about its centre.
    void drawMob(Canvas&, std::uint16_t index, double x, double y, double diameter,
                 double rotation, double timeSeconds) const;

    void drawPetal(Canvas&, std::uint16_t index, double x, double y, double diameter,
                   double rotation, double timeSeconds) const;

    /// True when the sprite compiled; false when the fallback disc is used.
    bool mobDrawable(std::uint16_t index) const;
    bool petalDrawable(std::uint16_t index) const;

    const std::vector<std::string>& warnings() const { return warnings_; }

private:
    struct Sprite {
        std::shared_ptr<SvgDocument> document;
        std::uint32_t fallbackColor = 0xFFFFFFu;
        bool usable = false;
    };

    void draw(Canvas&, const Sprite&, double x, double y, double diameter,
              double rotation, double timeSeconds) const;

    std::vector<Sprite> mobs_;
    std::vector<Sprite> petals_;
    std::vector<std::string> warnings_;
};

} // namespace flr
