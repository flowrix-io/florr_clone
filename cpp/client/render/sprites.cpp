#include "client/render/sprites.h"

#include <cmath>

#include "client/ui/draw.h"
#include "shared/game/config.h"

namespace flr {

namespace {

/// The fallback fill for a sprite that could not be compiled. Config colours
/// are stored as 0xRRGGBBAA by the loader; the drawing layer works in RGB.
std::uint32_t rgbOf(std::uint32_t rgba) { return rgba >> 8; }

} // namespace

bool SpriteCache::build(const ContentRegistry& content) {
    warnings_.clear();
    mobs_.assign(content.mobCount(), Sprite{});
    petals_.assign(content.petalCount(), Sprite{});

    const auto compile = [this](const std::string& source, std::uint32_t colorRgba,
                                const std::string& label, Sprite& out) {
        out.fallbackColor = rgbOf(colorRgba);
        if (source.empty()) {
            warnings_.push_back(label + ": no artwork, drawing a plain disc");
            return;
        }
        auto document = std::make_shared<SvgDocument>(SvgDocument::fromString(source));
        if (document->empty()) {
            warnings_.push_back(label + ": artwork produced no geometry");
            return;
        }
        for (const std::string& w : document->warnings()) {
            warnings_.push_back(label + ": " + w);
        }
        out.document = std::move(document);
        out.usable = true;
    };

    for (std::size_t i = 0; i < mobs_.size(); ++i) {
        const MobConfig& config = content.mob(static_cast<std::uint16_t>(i));
        compile(config.image, config.colorRgba, "mob " + config.id, mobs_[i]);
    }
    for (std::size_t i = 0; i < petals_.size(); ++i) {
        const PetalConfig& config = content.petal(static_cast<std::uint16_t>(i));
        compile(config.image, config.colorRgba, "petal " + config.id, petals_[i]);
    }

    return !mobs_.empty() && !petals_.empty();
}

bool SpriteCache::mobDrawable(std::uint16_t index) const {
    return index < mobs_.size() && mobs_[index].usable;
}

bool SpriteCache::petalDrawable(std::uint16_t index) const {
    return index < petals_.size() && petals_[index].usable;
}

void SpriteCache::draw(Canvas& canvas, const Sprite& sprite, double x, double y, double diameter,
                       double rotation, double timeSeconds) const {
    if (diameter <= 0.5) return;   // sub-pixel; not worth the transform

    if (!sprite.usable) {
        ui::disc(canvas, {x, y}, diameter * 0.5, sprite.fallbackColor);
        return;
    }

    canvas.save();
    canvas.translate(static_cast<float>(x), static_cast<float>(y));
    if (rotation != 0.0) canvas.rotate(static_cast<float>(rotation));
    // renderFitted maps the document's viewBox into the target box. Scaling by
    // width() instead is what made the artwork render at wildly wrong sizes --
    // these documents declare width="32" while drawing in a viewBox many times
    // that, and the two are unrelated.
    sprite.document->renderFitted(canvas,
                                  static_cast<float>(-diameter * 0.5),
                                  static_cast<float>(-diameter * 0.5),
                                  static_cast<float>(diameter),
                                  static_cast<float>(diameter),
                                  static_cast<float>(timeSeconds));
    canvas.restore();
}

void SpriteCache::drawMob(Canvas& canvas, std::uint16_t index, double x, double y, double diameter,
                          double rotation, double timeSeconds) const {
    if (index >= mobs_.size()) return;
    draw(canvas, mobs_[index], x, y, diameter, rotation, timeSeconds);
}

void SpriteCache::drawPetal(Canvas& canvas, std::uint16_t index, double x, double y,
                            double diameter, double rotation, double timeSeconds) const {
    if (index >= petals_.size()) return;
    draw(canvas, petals_[index], x, y, diameter, rotation, timeSeconds);
}

} // namespace flr
